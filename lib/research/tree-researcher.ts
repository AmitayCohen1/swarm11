/**
 * Tree Researcher - Runs a single node in the research tree
 *
 * Key difference from old researcher:
 * - Receives NodeContext (objective + lineage + task) instead of flat state
 * - Has full context of why it exists (lineage from root)
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { searchWeb } from './search';
import { NodeContext, SearchEvent } from './tree-types';
import { trackLlmCall } from '@/lib/eval';

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const EvaluateSchema = z.object({
  reasoning: z.string().describe('1-2 sentence rationale'),
  decision: z.enum(['continue', 'done']),
  query: z.string().describe('Next search query if continuing'),
});

const FinishSchema = z.object({
  finalDoc: z.string().describe('Comprehensive findings document'),
  confidence: z.enum(['low', 'medium', 'high']),
  suggestedFollowups: z.array(z.object({
    question: z.string(),
    reason: z.string(),
  })).max(2).describe('Potential follow-up questions for cortex to consider'),
});

// ============================================================
// Types
// ============================================================

export interface NodeRunResult {
  finalDoc: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedFollowups: Array<{ question: string; reason: string }>;
  searchHistory: SearchEvent[];
}

// ============================================================
// Run Node
// ============================================================

const MIN_SEARCHES = 3;
const MAX_SEARCHES = 10;

export interface NodeRunOptions {
  onProgress?: (searchHistory: SearchEvent[]) => void;
  signal?: AbortSignal;
}

export async function runTreeNode(
  context: NodeContext,
  options: NodeRunOptions = {}
): Promise<NodeRunResult> {
  const { onProgress, signal } = options;
  const searchHistory: SearchEvent[] = [];
  let nextQuery = context.task.question;

  // Search loop
  let searchCount = 0;
  while (searchCount < MAX_SEARCHES) {
    // Check abort before each operation
    if (signal?.aborted) {
      console.log(`[TreeResearcher] Aborted during search loop`);
      break;
    }

    // Search
    const searchResult = await searchWeb(nextQuery);
    searchCount++;

    // Check abort after search
    if (signal?.aborted) {
      console.log(`[TreeResearcher] Aborted after search`);
      break;
    }

    searchHistory.push({
      type: 'search',
      query: nextQuery,
      answer: searchResult.answer,
      sources: searchResult.sources,
      timestamp: Date.now(),
    });

    // Emit progress after search
    onProgress?.(searchHistory);

    // Check abort before evaluate
    if (signal?.aborted) {
      console.log(`[TreeResearcher] Aborted before evaluate`);
      break;
    }

    // Evaluate (reflect on what we learned)
    const evalResult = await evaluate(context, searchHistory);

    // Check abort after evaluate
    if (signal?.aborted) {
      console.log(`[TreeResearcher] Aborted after evaluate`);
      break;
    }

    // Add reflection to history
    searchHistory.push({
      type: 'reflect',
      thought: evalResult.reasoning,
      timestamp: Date.now(),
    });

    // Emit progress after reflect
    onProgress?.(searchHistory);

    // Prevent early done
    let decision = evalResult.decision;
    if (decision === 'done' && searchCount < MIN_SEARCHES) {
      decision = 'continue';
    }

    if (decision === 'done') {
      break;
    }

    nextQuery = evalResult.query || `more about ${context.task.question}`;
  }

  // If aborted, return early with what we have
  if (signal?.aborted) {
    console.log(`[TreeResearcher] Returning early due to abort`);
    return {
      finalDoc: 'Research stopped by user.',
      confidence: 'low',
      suggestedFollowups: [],
      searchHistory,
    };
  }

  // Finish
  const result = await finish(context, searchHistory);

  return {
    finalDoc: result.finalDoc,
    confidence: result.confidence,
    suggestedFollowups: result.suggestedFollowups,
    searchHistory,
  };
}

// ============================================================
// Evaluate
// ============================================================

async function evaluate(
  context: NodeContext,
  searchHistory: SearchEvent[]
): Promise<{ reasoning: string; decision: 'continue' | 'done'; query: string }> {
  const systemPrompt = buildEvaluatePrompt(context);
  const messages = buildMessages(searchHistory);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

  trackLlmCall({
    agentId: 'tree_researcher_evaluate',
    model: 'gpt-5.2',
    systemPrompt,
    input: { question: context.task.question, searchCount: searchHistory.length },
    output: data,
  }).catch(() => {});

  return data;
}

// ============================================================
// Finish
// ============================================================

async function finish(
  context: NodeContext,
  searchHistory: SearchEvent[]
): Promise<{
  finalDoc: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedFollowups: Array<{ question: string; reason: string }>;
}> {
  const systemPrompt = buildFinishPrompt(context);
  const messages = buildMessages(searchHistory);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;

  trackLlmCall({
    agentId: 'tree_researcher_finish',
    model: 'gpt-5.2',
    systemPrompt,
    input: { question: context.task.question, searchCount: searchHistory.length },
    output: data,
  }).catch(() => {});

  return data;
}

// ============================================================
// Prompt Builders
// ============================================================

function buildEvaluatePrompt(context: NodeContext): string {
  const lineageContext = context.lineage.length > 0
    ? context.lineage.map((l, i) => {
        const indent = '  '.repeat(i);
        const doc = l.finalDoc ? `\n${indent}  Result: ${l.finalDoc.substring(0, 200)}...` : '';
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
        return `${indent}→ ${l.question}: ${l.finalDoc?.substring(0, 150) || '(in progress)'}...`;
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

FOLLOW-UP SUGGESTIONS:
Suggest up to 3 follow-up questions based on gaps you found during research.
Each suggestion needs:
- question: SHORT (under 12 words), specific, searchable
- reason: Causal chain - "By learning X, we can Y → helps answer Z in objective"

Only suggest followups that would GENUINELY help the root objective.
If your answer is complete and no gaps remain, suggest 0 followups.`;
}

function buildMessages(history: SearchEvent[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Only include search events in messages (reflect events are internal reasoning)
  return history
    .filter((e): e is Extract<SearchEvent, { type: 'search' }> => e.type === 'search')
    .map((e) => {
      const sourcesText = e.sources && e.sources.length > 0
        ? `\n\nSources:\n${e.sources.slice(0, 5).map(s => `- ${s.title || s.url} (${s.url})`).join('\n')}`
        : '';
      return {
        role: 'user' as const,
        content: `Search: "${e.query}"\n\n${e.answer}${sourcesText}`,
      };
    });
}
