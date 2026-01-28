/**
 * LLM Call Tracker & Evaluator
 *
 * Tracks every LLM call, stores in DB, and triggers batch evaluation.
 * Metrics are discovered dynamically by the LLM and can be edited by users.
 */

import { db } from '@/lib/db';
import { llmCalls, llmEvaluations } from '@/lib/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getAgent, updateAgentMetrics, Metric } from './agents';

const DEFAULT_EVAL_BATCH_SIZE = 3;
const EVAL_MODEL = openai('gpt-5.1');

// Re-export for convenience
export { createAgent, getAgent, getAllAgents, deleteAgent, updateAgentMetrics, addAgentMetric, updateAgentEvalBatchSize } from './agents';
export type { Metric } from './agents';

// ============================================================
// Track LLM Call
// ============================================================

export interface TrackLlmCallParams {
  agentId: string;
  model: string;
  systemPrompt?: string;
  input: unknown;
  output: unknown;
  durationMs?: number;
  tokenCount?: number;
  chatSessionId?: string;
}

export async function trackLlmCall(params: TrackLlmCallParams): Promise<string | null> {
  // Only track if agent was manually created
  const agent = await getAgent(params.agentId);
  if (!agent) {
    console.log(`[Track] Skipping unregistered agent: ${params.agentId}`);
    return null;
  }

  const evalBatchSize = Math.max(1, agent.evalBatchSize ?? DEFAULT_EVAL_BATCH_SIZE);

  // Save the call
  const [inserted] = await db.insert(llmCalls).values({
    agentName: params.agentId,
    model: params.model,
    systemPrompt: params.systemPrompt,
    input: params.input,
    output: params.output,
    durationMs: params.durationMs,
    tokenCount: params.tokenCount,
    chatSessionId: params.chatSessionId,
  }).returning({ id: llmCalls.id });

  // Check if we should trigger evaluation
  const unevaluatedCount = await db
    .select({ count: count() })
    .from(llmCalls)
    .where(and(
      eq(llmCalls.agentName, params.agentId),
      eq(llmCalls.evaluated, false)
    ));

  const pendingCount = unevaluatedCount[0]?.count ?? 0;

  if (pendingCount >= evalBatchSize) {
    // Trigger evaluation in background (don't await)
    runEvaluation(params.agentId).catch(err => {
      console.error(`[Eval] Failed to run evaluation for ${params.agentId}:`, err);
    });
  }

  return inserted.id;
}

// ============================================================
// Run Evaluation
// ============================================================

interface EvalResult {
  scores: Record<string, number>;
  reasoning?: Record<string, string>;
  insights: string;
  suggestedMetrics?: Metric[];
}

async function runEvaluation(agentId: string): Promise<void> {
  console.log(`[Eval] Running evaluation for ${agentId}`);

  // Get agent info
  const agent = await getAgent(agentId);
  if (!agent) {
    console.log(`[Eval] Agent ${agentId} not found, skipping evaluation`);
    return;
  }

  const evalBatchSize = Math.max(1, agent.evalBatchSize ?? DEFAULT_EVAL_BATCH_SIZE);
  const hasMetrics = agent.metrics && agent.metrics.length > 0;

  // When discovering metrics, get multiple calls to see patterns
  // When evaluating, just get the most recent one
  const callLimit = hasMetrics ? 1 : evalBatchSize;

  const calls = await db
    .select()
    .from(llmCalls)
    .where(and(
      eq(llmCalls.agentName, agentId),
      eq(llmCalls.evaluated, false)
    ))
    .orderBy(desc(llmCalls.createdAt))
    .limit(callLimit);

  if (calls.length === 0) {
    console.log(`[Eval] No calls to evaluate for ${agentId}`);
    return;
  }

  // Build evaluation prompt - pass all calls for metric discovery, single call for scoring
  const evalPrompt = hasMetrics
    ? buildEvalPrompt(agent, calls[0])
    : buildMetricDiscoveryPrompt(agent, calls);

  // Run evaluation
  const result = await generateText({
    model: EVAL_MODEL,
    prompt: evalPrompt,
  });

  // Parse evaluation (expecting JSON in response)
  let evalResult: EvalResult;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    evalResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { scores: {}, insights: result.text };
  } catch {
    evalResult = {
      scores: { overall: 0 },
      insights: result.text,
    };
  }

  // Save evaluation
  const [evaluation] = await db.insert(llmEvaluations).values({
    agentName: agentId,
    callCount: calls.length,
    scores: evalResult.scores,
    reasoning: evalResult.reasoning || null,
    insights: evalResult.insights,
    recommendations: evalResult.suggestedMetrics ? JSON.stringify(evalResult.suggestedMetrics) : null,
  }).returning({ id: llmEvaluations.id });

  // Mark all analyzed calls as evaluated
  for (const call of calls) {
    await db.update(llmCalls)
      .set({ evaluated: true, evaluationBatchId: evaluation.id })
      .where(eq(llmCalls.id, call.id));
  }

  console.log(`[Eval] Completed evaluation for ${agentId}: ${JSON.stringify(evalResult.scores)}`);
}

// ============================================================
// Evaluation Prompt Builder
// ============================================================

function formatCallForPrompt(call: typeof llmCalls.$inferSelect, index?: number): string {
  const header = index !== undefined ? `--- CALL ${index + 1} ---` : '';
  return `${header}
System Prompt: ${call.systemPrompt ? call.systemPrompt.substring(0, 500) + (call.systemPrompt.length > 500 ? '...' : '') : '(none)'}
Input: ${JSON.stringify(call.input, null, 2).substring(0, 600)}
Output: ${JSON.stringify(call.output, null, 2).substring(0, 600)}
`.trim();
}

function buildEvalPrompt(
  agent: { id: string; name: string; description: string; metrics?: Metric[] },
  call: typeof llmCalls.$inferSelect
): string {
  const callText = formatCallForPrompt(call);

  return `Evaluate this LLM call from "${agent.name}" agent.
Agent: ${agent.description}

${callText}

Score each metric 1-10:
${agent.metrics!.map(m => `- ${m.name}: ${m.description}`).join('\n')}

Return JSON only:
{
  "scores": {
    ${agent.metrics!.map(m => `"${m.name}": <1-10>`).join(',\n    ')},
    "overall": <1-10>
  },
  "reasoning": {
    ${agent.metrics!.map(m => `"${m.name}": "<10 words: why this score>"`).join(',\n    ')}
  },
  "insights": "<MAX 20 words: key strength + key weakness>",
  "suggestedMetrics": []
}`;
}

function buildMetricDiscoveryPrompt(
  agent: { id: string; name: string; description: string; metrics?: Metric[] },
  calls: (typeof llmCalls.$inferSelect)[]
): string {
  const callsText = calls.map((call, i) => formatCallForPrompt(call, i)).join('\n\n');

  return `You are analyzing an AI agent to discover what quality metrics matter for evaluating it.

AGENT: "${agent.name}"
PURPOSE: ${agent.description}

HERE ARE ${calls.length} RECENT CALLS FROM THIS AGENT:

${callsText}

YOUR TASK: Figure out what makes a GOOD result vs a BAD result for this specific agent.

Analyze:
1. What is this agent supposed to do? (look at the system prompt and purpose)
2. Looking at these outputs - what aspects could vary in quality?
3. What would a PERFECT response look like for this agent? What would a TERRIBLE one look like?
4. What are the 2-3 key dimensions that separate good from bad?

IMPORTANT:
- BE SPECIFIC to this agent's job. No generic metrics like "Quality" or "Helpfulness"
- Each metric should be something you can clearly judge by looking at the output
- Think about what the USER of this agent actually cares about

Examples of good metrics for different agents:
- Code generator → "Correctness" (runs without errors), "Readability" (clear variable names, structure)
- Summarizer → "Coverage" (captures key points), "Conciseness" (no unnecessary info)
- Q&A bot → "Accuracy" (factually correct), "Directness" (answers the question asked)
- Data extractor → "Completeness" (finds all items), "Format" (follows expected structure)

Return JSON only:
{
  "scores": {
    "overall": <1-10 average quality across these examples>
  },
  "insights": "<20 words: patterns you noticed - what's working well, what could improve>",
  "suggestedMetrics": [
    { "name": "<1-2 words>", "description": "<What this measures - be specific to this agent>" }
  ]
}`;
}

// ============================================================
// Manual Evaluation Trigger
// ============================================================

export async function triggerEvaluation(agentId: string): Promise<void> {
  await runEvaluation(agentId);
}

// ============================================================
// Get Evaluation Stats
// ============================================================

export async function getEvaluationStats(agentId?: string) {
  const whereClause = agentId ? eq(llmEvaluations.agentName, agentId) : undefined;

  const evaluations = await db
    .select()
    .from(llmEvaluations)
    .where(whereClause)
    .orderBy(desc(llmEvaluations.createdAt))
    .limit(20);

  return evaluations;
}

export async function getPendingCallsCount(agentId?: string) {
  const whereClause = agentId
    ? and(eq(llmCalls.agentName, agentId), eq(llmCalls.evaluated, false))
    : eq(llmCalls.evaluated, false);

  const result = await db
    .select({ count: count() })
    .from(llmCalls)
    .where(whereClause);

  return result[0]?.count ?? 0;
}
