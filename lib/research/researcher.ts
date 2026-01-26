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

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const EvaluateSchema = z.object({
  reasoning: z.string(),
  decision: z.enum(['continue', 'done']),
  query: z.string(),
});

const FinishSchema = z.object({
  answer: z.string(),
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
      messages.push({ role: 'user', content: `Search for "${e.query}":\n${e.answer}` });
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

  const result = await generateText({
    model,
    // PROMPT GOAL (Researcher.evaluate): Given a single question + its search/reflection history,
    // decide whether to keep searching and propose the next web query.
    // Output = { decision: 'continue'|'done', query, reasoning }.
    system: researchQuestionEvalPrompt({ objective, question, goal }),
    messages,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

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

  const result = await generateText({
    model,
    system: `You are summarizing research findings.

Main objective: ${objective}
Sub-question researched: ${question}
Goal: ${goal || '(not provided)'}

Based on the search results in this conversation, write a clear summary of what was found.
Include key facts, data points, and explicitly note any gaps or uncertainties.

Do NOT include any JSON, decision fields, or structured output format in your answer.
Just write a plain text summary.`,
    messages,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;

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

    const searchEvent: ResearchQuestionEvent = { type: 'search', query: nextQuery, answer: searchResult.answer };
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
