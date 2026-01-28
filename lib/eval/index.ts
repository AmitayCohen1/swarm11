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
import { z } from 'zod';
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

const MetricSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const EvalResultSchema = z.object({
  scores: z.record(z.string(), z.number()),
  reasoning: z.record(z.string(), z.string()).optional(),
  insights: z.string(),
  suggestedMetrics: z.array(MetricSchema).optional(),
});

function normalizeMetricName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ');
}

function clampScore(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
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

  // Run evaluation - use text parsing since OpenAI doesn't support z.record() in structured output
  let evalResult: EvalResult = { scores: { overall: 0 }, insights: 'Evaluation failed to parse.' };
  try {
    const result = await generateText({
      model: EVAL_MODEL,
      prompt: evalPrompt + '\n\nRespond with valid JSON only, no markdown.',
      providerOptions: {
        openai: {
          reasoningEffort: 'low',
        },
      },
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (parsed && typeof parsed === 'object') {
      evalResult = {
        scores: (parsed.scores as Record<string, number>) || {},
        reasoning: (parsed.reasoning as Record<string, string>) || undefined,
        insights: (parsed.insights as string) || result.text,
        suggestedMetrics: (parsed.suggestedMetrics as Metric[]) || undefined,
      };
    } else {
      evalResult = { scores: { overall: 0 }, insights: result.text };
    }
  } catch (err) {
    console.error('[Eval] Evaluation failed:', err);
    evalResult = { scores: { overall: 0 }, insights: 'Evaluation failed.' };
  }

  // Normalize / clamp scores and ensure required keys exist
  const normalizedScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(evalResult.scores || {})) {
    normalizedScores[normalizeMetricName(k)] = clampScore(v);
  }

  // Ensure metric keys exist for scoring mode
  if (hasMetrics && agent.metrics) {
    for (const m of agent.metrics) {
      const key = normalizeMetricName(m.name);
      if (!(key in normalizedScores)) normalizedScores[key] = 0;
    }
  }

  // Fill / compute overall if missing
  if (!('overall' in normalizedScores)) {
    const metricKeys = Object.keys(normalizedScores).filter((k) => k !== 'overall');
    const avg = metricKeys.length
      ? metricKeys.reduce((sum, k) => sum + (normalizedScores[k] || 0), 0) / metricKeys.length
      : 0;
    normalizedScores.overall = clampScore(avg);
  }

  evalResult.scores = normalizedScores;
  evalResult.insights = (evalResult.insights || '').trim().slice(0, 2000);

  // If we're in discovery mode and got suggestions, optionally auto-apply them so scoring can start
  if (!hasMetrics && Array.isArray(evalResult.suggestedMetrics) && evalResult.suggestedMetrics.length > 0) {
    const existing = agent.metrics || [];
    const existingNames = new Set(existing.map((m) => normalizeMetricName(m.name).toLowerCase()));

    const merged: Metric[] = [...existing];
    for (const s of evalResult.suggestedMetrics) {
      const name = normalizeMetricName(s?.name || '');
      const description = String(s?.description || '').trim();
      if (!name || !description) continue;
      const key = name.toLowerCase();
      if (existingNames.has(key)) continue;
      merged.push({ name, description });
      existingNames.add(key);
    }

    // Only write if we actually added something
    if (merged.length !== existing.length) {
      await updateAgentMetrics(agentId, merged);
    }
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
System Prompt: ${call.systemPrompt ? call.systemPrompt.substring(0, 2000) + (call.systemPrompt.length > 2000 ? '...' : '') : '(none)'}
Input: ${JSON.stringify(call.input, null, 2).substring(0, 2000)}
Output: ${JSON.stringify(call.output, null, 2).substring(0, 3000)}
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
  // Extract system prompts from calls - these contain the actual rules
  const systemPrompts = calls
    .map(c => c.systemPrompt)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i); // unique

  const systemPromptText = systemPrompts.length > 0
    ? systemPrompts[0] // Use the first (they should all be the same for an agent)
    : '(no system prompt found)';

  const callExamples = calls
    .slice(0, 3)
    .map((c, i) => formatCallForPrompt(c, i))
    .join('\n\n');

  // Existing metrics to avoid duplicates
  const existingMetrics = agent.metrics && agent.metrics.length > 0
    ? agent.metrics.map(m => `- ${m.name}: ${m.description}`).join('\n')
    : null;

  return `You are extracting evaluation metrics from an agent's system prompt.

AGENT: "${agent.name}"
${existingMetrics ? `
EXISTING METRICS (already defined - do NOT suggest these again):
${existingMetrics}
` : ''}
SYSTEM PROMPT (this defines what the agent should do):
---
${systemPromptText}
---

RECENT CALLS (for context; use these only to see how the rules show up in practice):
${callExamples || '(none)'}

YOUR TASK: Extract the explicit quality criteria from the system prompt above that are NOT already covered by existing metrics.

The system prompt contains rules like:
- "must be self-contained"
- "use concise wording (4-7 words)"
- "do NOT extract common knowledge"
- "avoid ambiguous subjects"

Each of these is a metric. Your job is to find them and turn them into evaluation criteria.

INSTRUCTIONS:
1. READ the system prompt carefully
2. FIND all explicit rules, requirements, and constraints:
   - Look for: "must", "should", "do NOT", "avoid", "never", "always"
   - Look for: numbered lists, bullet points, examples of good/bad output
   - Look for: format requirements, length constraints, style guidelines
3. CONVERT each rule into a metric with:
   - name: 2-4 word label (e.g., "Self-contained", "Concise wording", "No common knowledge")
   - description: Format as "Prompt says '...' so here we measure ..." (quote the rule, then explain what we check)
4. Prefer rules that are stable across calls (not objective-specific content)

DO NOT invent abstract metrics. Only extract what's explicitly stated.
DO NOT use generic metrics like "Quality", "Helpfulness", "Accuracy" unless the prompt explicitly defines what those mean.
DO NOT suggest metrics that duplicate or overlap with existing metrics listed above.
DO NOT extract non-rules (e.g., the user's objective, examples, or background context) unless it's phrased as an instruction.

Return JSON only:
{
  "scores": {
    "overall": <1-10 how well the example output follows these rules>
  },
  "insights": "<20 words: which rules are being followed, which are being violated>",
  "suggestedMetrics": [
    { "name": "<2-4 words>", "description": "Prompt says '<quote rule>' so here we measure <what we check>" }
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
