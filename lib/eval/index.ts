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

const EVAL_BATCH_SIZE = 5;
const EVAL_MODEL = openai('gpt-5.1');

// Re-export for convenience
export { createAgent, getAgent, getAllAgents, deleteAgent, updateAgentMetrics, addAgentMetric } from './agents';
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

  if (pendingCount >= EVAL_BATCH_SIZE) {
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

  // Get the most recent unevaluated call for this agent
  const calls = await db
    .select()
    .from(llmCalls)
    .where(and(
      eq(llmCalls.agentName, agentId),
      eq(llmCalls.evaluated, false)
    ))
    .orderBy(desc(llmCalls.createdAt))
    .limit(1);

  if (calls.length === 0) {
    console.log(`[Eval] No calls to evaluate for ${agentId}`);
    return;
  }

  const call = calls[0];

  // Build evaluation prompt
  const evalPrompt = buildEvalPrompt(agent, call);

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
    callCount: 1,
    scores: evalResult.scores,
    reasoning: evalResult.reasoning || null,
    insights: evalResult.insights,
    recommendations: evalResult.suggestedMetrics ? JSON.stringify(evalResult.suggestedMetrics) : null,
  }).returning({ id: llmEvaluations.id });

  // Mark this specific call as evaluated
  await db.update(llmCalls)
    .set({ evaluated: true, evaluationBatchId: evaluation.id })
    .where(eq(llmCalls.id, call.id));

  console.log(`[Eval] Completed evaluation for ${agentId}: ${JSON.stringify(evalResult.scores)}`);
}

// ============================================================
// Evaluation Prompt Builder
// ============================================================

function buildEvalPrompt(
  agent: { id: string; name: string; description: string; metrics?: Metric[] },
  call: typeof llmCalls.$inferSelect
): string {
  const hasMetrics = agent.metrics && agent.metrics.length > 0;

  const callText = `
System Prompt: ${call.systemPrompt ? call.systemPrompt.substring(0, 500) + '...' : '(none)'}
Input: ${JSON.stringify(call.input, null, 2).substring(0, 800)}
Output: ${JSON.stringify(call.output, null, 2).substring(0, 800)}
`;

  if (hasMetrics) {
    // Evaluate on existing metrics
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
  } else {
    // No metrics yet - suggest key metrics
    return `Evaluate this LLM call from "${agent.name}" agent.
Agent: ${agent.description}

${callText}

Suggest exactly 2-3 KEY metrics for this agent. Requirements:
- Metric names: 1-2 words, clear (e.g., "Accuracy", "Relevance", "Completeness")
- Descriptions: One short sentence, specific to this agent
- Only essential metrics that matter most

Return JSON only:
{
  "scores": {
    "overall": <1-10>
  },
  "insights": "<MAX 20 words: key observation>",
  "suggestedMetrics": [
    { "name": "MetricName", "description": "One sentence description" }
  ]
}`;
  }
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
