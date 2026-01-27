/**
 * Researcher - Question-level evaluate/finish cycle
 *
 * Same pattern as brain:
 *   evaluate(state) → continue or done?
 *   finish(state) → produce output
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { searchWeb } from './search';
import type { ResearchQuestionMemory, ResearchQuestionEvent } from './types';
import { researchQuestionEvalPrompt } from '@/lib/prompts/research';
import { trackLlmCall } from '@/lib/eval';

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const EvaluateSchema = z.object({
  reasoning: z.string().describe('1–2 sentence rationale for continue vs done'),
  decision: z.enum(['continue', 'done']),
  query: z
    .string()
    .describe('Next web query to run: short, specific, human-readable (no quotes/keyword soup)'),
});

const FinishSchema = z.object({
  answer: z
    .string()
    .describe('Markdown summary. Prefer bullets/headings.'),
  confidence: z.enum(['low', 'medium', 'high']),
});

// ============================================================
// Evaluate - Look at search history, decide continue/done
// ============================================================

export interface EvaluateResult {
  reasoning: string;
  decision: 'continue' | 'done';
  query: string;
}

function buildMessages(history: ResearchQuestionEvent[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const e of history) {
    if (e.type === 'search') {
      const sourcesText = e.sources && e.sources.length > 0
        ? `\n\nSources:\n${e.sources.slice(0, 5).map(s => `- ${s.title || s.url} (${s.url})`).join('\n')}`
        : '';
      messages.push({ role: 'user', content: `Search for "${e.query}":\n${e.answer}${sourcesText}` });
    } else {
      messages.push({ role: 'assistant', content: e.thought });
    }
  }
  return messages;
}

export async function evaluate(
  question: string,
  objective: string,
  history: ResearchQuestionEvent[],
  goal?: string
): Promise<EvaluateResult> {
  const messages = buildMessages(history);
  const systemPrompt = researchQuestionEvalPrompt({ objective, question, goal });

  const result = await generateText({
    model,
    // PROMPT GOAL (Researcher.evaluate): Given a single question + its search/reflection history,
    // decide whether to keep searching and propose the next web query.
    // Output = { decision: 'continue'|'done', query, reasoning }.
    system: systemPrompt,
    messages,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

  // Track for evaluation
  trackLlmCall({
    agentId: 'vveyd_AC0xrt', // Researcher Evaluate
    model: 'gpt-5.2',
    systemPrompt,
    input: { question, objective, goal, messagesCount: messages.length },
    output: data,
  }).catch(() => {}); // Fire and forget

  return {
    reasoning: data.reasoning,
    decision: data.decision,
    query: data.query,
  };
}

// ============================================================
// Finish - Combine all search results into question answer
// ============================================================

export interface FinishResult {
  answer: string;
  confidence: 'low' | 'medium' | 'high';
}

export async function finish(
  question: string,
  objective: string,
  history: ResearchQuestionEvent[],
  goal?: string
): Promise<FinishResult> {
  const messages = buildMessages(history);
  const systemPrompt = `Role: Researcher.finish
Objective: ${objective}
Question: ${question}
Goal: ${goal || '(not provided)'}

Task: summarize what was found + key gaps, using ONLY the provided search results.
Be concrete (names/dates/numbers when present). Avoid generic filler.
Return JSON: { answer: string, confidence: "low"|"medium"|"high" }`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;

  // Track for evaluation
  trackLlmCall({
    agentId: 's98-GcuqAXIl', // Researcher Finish
    model: 'gpt-5.2',
    systemPrompt,
    input: { question, objective, goal, messagesCount: messages.length },
    output: data,
  }).catch(() => {}); // Fire and forget

  return {
    answer: data.answer,
    confidence: data.confidence,
  };
}

// ============================================================
// Run Question - Orchestrates the evaluate/search/finish loop
// ============================================================

const MIN_SEARCHES = 3;
const MAX_SEARCHES = 15;

export interface RunQuestionResult {
  question: ResearchQuestionMemory;
  searchCount: number;
}

export async function runQuestion(
  question: ResearchQuestionMemory,
  objective: string,
  onProgress?: (update: any) => void
): Promise<RunQuestionResult> {
  const log = (msg: string) => console.log(`[Researcher ${question.id.substring(0, 8)}] ${msg}`);

  const q: ResearchQuestionMemory = { ...question, status: 'running', history: [...question.history] };
  let searchCount = 0;
  let nextQuery = q.question; // Start with the question itself

  log(`Starting: ${q.question.substring(0, 50)}`);
  onProgress?.({ type: 'question_started', questionId: q.id, questionText: q.question });

  while (searchCount < MAX_SEARCHES) {
    // Search
    const searchResult = await searchWeb(nextQuery);
    searchCount++;

    const searchEvent: ResearchQuestionEvent = {
      type: 'search',
      query: nextQuery,
      answer: searchResult.answer,
      sources: searchResult.sources
    };
    q.history.push(searchEvent);

    log(`Search ${searchCount}: "${nextQuery.substring(0, 40)}..." → ${searchResult.answer.length} chars`);
    onProgress?.({ type: 'question_search', questionId: q.id, query: nextQuery, answerLength: searchResult.answer.length, question: q });

    // Evaluate
    const evalResult = await evaluate(q.question, objective, q.history, q.goal);

    // Prevent early done
    let decision = evalResult.decision;
    if (decision === 'done' && searchCount < MIN_SEARCHES) {
      decision = 'continue';
    }

    const reflectEvent: ResearchQuestionEvent = { type: 'reflect', thought: evalResult.reasoning };
    q.history.push(reflectEvent);

    onProgress?.({ type: 'question_evaluate', questionId: q.id, reasoning: evalResult.reasoning, decision, question: q });

    if (decision === 'done') {
      break;
    }

    nextQuery = evalResult.query || `more about ${q.question}`;
  }

  // Finish
  const finishResult = await finish(q.question, objective, q.history, q.goal);
  q.answer = finishResult.answer;
  q.confidence = finishResult.confidence;
  q.status = 'done';

  log(`Done: ${searchCount} searches, ${q.answer.length} char answer`);
  onProgress?.({ type: 'question_done', questionId: q.id, answerLength: q.answer.length });

  return { question: q, searchCount };
}
