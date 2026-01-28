/**
 * Researcher - Runs a single research node
 *
 * Executes a search loop:
 * 1. Search the web
 * 2. Reflect on what we learned
 * 3. Decide: continue searching or done?
 * 4. When done, synthesize findings
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { searchWeb } from './search';
import {
  NodeContext,
  SearchEntry,
  Followup,
  RESEARCH_MODEL,
  RESEARCH_LIMITS,
} from './types';
import { trackLlmCall } from '@/lib/eval';

const model = openai(RESEARCH_MODEL);

// ============================================================
// Schemas
// ============================================================

const EvaluateSchema = z.object({
  reasoning: z.string().describe('1-2 sentence rationale'),
  decision: z.enum(['continue', 'done']),
  query: z.string().describe('Next search query if continuing'),
});

const FinishSchema = z.object({
  answer: z.string().describe('Comprehensive findings document'),
  confidence: z.enum(['low', 'medium', 'high']),
  suggestedFollowups: z.array(z.object({
    question: z.string(),
    reason: z.string(),
  })).max(RESEARCH_LIMITS.maxFollowupsPerNode).describe('Potential follow-up questions for cortex to consider'),
});

// ============================================================
// Types
// ============================================================

export interface NodeResult {
  answer: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedFollowups: Followup[];
  searches: SearchEntry[];
  tokens: number;
}

export interface NodeRunOptions {
  onProgress?: (searches: SearchEntry[]) => void;
  signal?: AbortSignal;
}

// ============================================================
// Main: Run Node
// ============================================================

export async function runNode(
  context: NodeContext,
  options: NodeRunOptions = {}
): Promise<NodeResult> {
  const { onProgress, signal } = options;
  const searches: SearchEntry[] = [];
  let nextQuery = context.task.question;
  let totalTokens = 0;

  // Search loop
  let searchCount = 0;
  while (searchCount < RESEARCH_LIMITS.maxSearchesPerNode) {
    if (signal?.aborted) {
      console.log(`[Researcher] Aborted during search loop`);
      break;
    }

    // Execute search
    const searchResult = await searchWeb(nextQuery);
    searchCount++;

    if (signal?.aborted) break;

    // Record search
    const entry: SearchEntry = {
      query: nextQuery,
      result: searchResult.answer,
      sources: searchResult.sources,
      timestamp: Date.now(),
    };
    searches.push(entry);
    onProgress?.(searches);

    if (signal?.aborted) break;

    // Evaluate: should we continue?
    const evalResult = await evaluate(context, searches);
    totalTokens += evalResult.tokens;

    if (signal?.aborted) break;

    // Add reflection to the entry
    entry.reflection = evalResult.reasoning;
    onProgress?.(searches);

    // Enforce minimum searches
    let decision = evalResult.decision;
    if (decision === 'done' && searchCount < RESEARCH_LIMITS.minSearchesPerNode) {
      decision = 'continue';
    }

    if (decision === 'done') break;

    nextQuery = evalResult.query || `more about ${context.task.question}`;
  }

  // If aborted, return early
  if (signal?.aborted) {
    return {
      answer: 'Research stopped by user.',
      confidence: 'low',
      suggestedFollowups: [],
      searches,
      tokens: totalTokens,
    };
  }

  // Synthesize final answer
  const result = await finish(context, searches);
  totalTokens += result.tokens;

  return {
    answer: result.answer,
    confidence: result.confidence,
    suggestedFollowups: result.suggestedFollowups,
    searches,
    tokens: totalTokens,
  };
}

// ============================================================
// Evaluate
// ============================================================

async function evaluate(
  context: NodeContext,
  searches: SearchEntry[]
): Promise<{ reasoning: string; decision: 'continue' | 'done'; query: string; tokens: number }> {
  const systemPrompt = buildEvaluatePrompt(context);
  const messages = buildMessages(searches);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 'vveyd_AC0xrt', // Researcher Evaluate (Observatory)
    model: RESEARCH_MODEL,
    systemPrompt,
    input: { question: context.task.question, searchCount: searches.length },
    output: data,
    tokenCount: tokens,
  }).catch(() => {});

  return { ...data, tokens };
}

// ============================================================
// Finish
// ============================================================

async function finish(
  context: NodeContext,
  searches: SearchEntry[]
): Promise<{
  answer: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedFollowups: Followup[];
  tokens: number;
}> {
  const systemPrompt = buildFinishPrompt(context);
  const messages = buildMessages(searches);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 's98-GcuqAXIl', // Researcher Finish (Observatory)
    model: RESEARCH_MODEL,
    systemPrompt,
    input: { question: context.task.question, searchCount: searches.length },
    output: data,
    tokenCount: tokens,
  }).catch(() => {});

  return { ...data, tokens };
}

// ============================================================
// Prompt Builders
// ============================================================

function buildEvaluatePrompt(context: NodeContext): string {
  const lineageContext = context.lineage.length > 0
    ? context.lineage.map((l, i) => {
        const indent = '  '.repeat(i);
        const doc = l.answer ? `\n${indent}  Result: ${l.answer.substring(0, 200)}...` : '';
        return `${indent}→ ${l.question} (${l.reason})${doc}`;
      }).join('\n')
    : '(Root level - no parent research)';

  return `You are a focused researcher working on ONE specific question.

ROOT OBJECTIVE: ${context.objective}

HOW WE GOT HERE (research lineage):
${lineageContext}

YOUR TASK:
Question: ${context.task.question}
Why: ${context.task.reason}

After each search, decide:
- "continue" if important gaps remain
- "done" if you have enough to write a solid answer

If continuing, provide your next search query (specific, not keyword soup).`;
}

function buildFinishPrompt(context: NodeContext): string {
  const lineageContext = context.lineage.length > 0
    ? context.lineage.map((l, i) => {
        const indent = '  '.repeat(i);
        return `${indent}→ ${l.question}: ${l.answer?.substring(0, 150) || '(in progress)'}...`;
      }).join('\n')
    : '(Root level)';

  return `You are synthesizing your research findings.

ROOT OBJECTIVE: ${context.objective}

RESEARCH LINEAGE:
${lineageContext}

YOUR TASK:
Question: ${context.task.question}
Why: ${context.task.reason}

Write a comprehensive findings document that:
1. Directly answers the question
2. Includes specific facts, numbers, names when available
3. Notes any important gaps or uncertainties
4. Considers how this connects to the root objective

OUTPUT SHAPE (keep it tight and decision-ready):
- Start with a 3–6 bullet summary of the answer (high signal).
- Then include evidence as short bullets with source hints (who/what/when/where).
- If applicable, include a small shortlist/table (up to 5 items) with:
  name/item | why it matters | evidence/source
- Include a brief "Excluded / deprioritized" section ONLY if you ruled things out:
  list what you discarded and why (to prevent repeating dead ends).
- End with "Remaining unknowns" (max 3) if the answer is not fully confident.

FOLLOW-UP SUGGESTIONS (0-${RESEARCH_LIMITS.maxFollowupsPerNode}):
Only suggest a followup if you genuinely believe it will help achieve: "${context.objective}"

Ask yourself: "If I had this answer, would it materially change what we recommend to the user?"
If no → don't suggest it.

When suggesting:
- question: SHORT (under 12 words), hypothesis-driven, specific
- reason: "I'm suggesting this because [specific gap] → [how it helps the main objective]"

Examples of BAD followups (don't do these):
- Generic background questions that won't change the answer
- "Nice to know" tangents that are interesting but not actionable
- Questions already answered or being researched elsewhere

Examples of GOOD followups:
- "Which of these 5 companies had layoffs recently?" → timing signal for outreach
- "What's the typical deal size for podcast networks?" → helps prioritize targets

If your findings are solid and actionable, suggest 0 followups. Don't pad.`;
}

function buildMessages(searches: SearchEntry[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return searches.map((s) => {
    const sourcesText = s.sources && s.sources.length > 0
      ? `\n\nSources:\n${s.sources.slice(0, 5).map(src => `- ${src.title || src.url} (${src.url})`).join('\n')}`
      : '';
    return {
      role: 'user' as const,
      content: `Search: "${s.query}"\n\n${s.result}${sourcesText}`,
    };
  });
}
