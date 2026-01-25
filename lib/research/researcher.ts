/**
 * Researcher - Runs search/reflect loop for one question
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { searchWeb } from './search';
import type { ResearchQuestionMemory, ResearchQuestionEvent } from './types';

const model = openai('gpt-5.2');

const ReflectSchema = z.object({
  thought: z.string().describe('What you learned and what to do next'),
  status: z.enum(['continue', 'done']),
  nextQuery: z.string().describe('Next search query if continue, empty if done'),
});

const SummarizeSchema = z.object({
  answer: z.string().describe('Comprehensive answer to the question'),
  confidence: z.enum(['low', 'medium', 'high']).describe('How confident you are in this answer'),
});

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
  onProgress?.({ type: 'question_started', questionId: q.id, question: q.question });

  while (searchCount < MAX_SEARCHES) {
    // Search
    const result = await searchWeb(nextQuery);
    searchCount++;

    const searchEvent: ResearchQuestionEvent = { type: 'search', query: nextQuery, answer: result.answer };
    q.history.push(searchEvent);

    log(`Search ${searchCount}: "${nextQuery.substring(0, 40)}..." → ${result.answer.length} chars`);
    onProgress?.({ type: 'question_search', questionId: q.id, query: nextQuery, answerLength: result.answer.length, question: q });

    // Build messages array from history
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const e of q.history) {
      if (e.type === 'search') {
        // Search results come in as "user" (external info)
        messages.push({ role: 'user', content: `Search for "${e.query}":\n${e.answer.substring(0, 600)}` });
      } else {
        // Reflections are assistant's own thoughts
        messages.push({ role: 'assistant', content: e.thought });
      }
    }

    // Reflect
    const reflectResult = await generateText({
      model,
      system: `You are part of a research system. 
      
      Our main obejctive is: ${objective}
      We are a spesific branch, that has research question: ${q.question}
      Keep asking relevant questions to answer the question or seeing it's a dead end.
      Return this schema: 

      {
        thought: "what you learned from last search and what we should do next (ask another question or finish.)"
        status: "continue" or "done"
        nextQuery: "Next search query if continue, empty if done"
      }
      `,
      messages,
      output: Output.object({ schema: ReflectSchema }),
    });

    const reflect = reflectResult.output as z.infer<typeof ReflectSchema>;

    // Prevent early done
    let status = reflect.status;
    if (status === 'done' && searchCount < MIN_SEARCHES) {
      status = 'continue';
    }

    const reflectEvent: ResearchQuestionEvent = { type: 'reflect', thought: reflect.thought };
    q.history.push(reflectEvent);

    onProgress?.({ type: 'question_reflect', questionId: q.id, thought: reflect.thought, status, question: q });

    if (status === 'done') {
      break;
    }

    nextQuery = reflect.nextQuery || `more about ${q.question}`;
  }

  // Summarize - use same messages format
  const summaryMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const e of q.history) {
    if (e.type === 'search') {
      summaryMessages.push({ role: 'user', content: `Search for "${e.query}":\n${e.answer.substring(0, 600)}` });
    } else {
      summaryMessages.push({ role: 'assistant', content: e.thought });
    }
  }

  const summaryResult = await generateText({
    model,
    system: `You are part of a research system.

Our main objective is: ${objective}
You are a specific branch that researched: ${q.question}

You've finished searching. Now summarize what you found.
This summary goes to the evaluator who decides if we need more research.

Return this schema:
{
  answer: "Clear summary of what you found that helps answer the main objective",
  confidence: "low" | "medium" | "high"
}`,
    messages: summaryMessages,
    output: Output.object({ schema: SummarizeSchema }),
  });

  const summary = summaryResult.output as z.infer<typeof SummarizeSchema>;
  q.answer = summary.answer;
  q.confidence = summary.confidence;
  q.status = 'done';

  log(`Done: ${searchCount} searches, ${q.answer.length} char answer`);
  onProgress?.({ type: 'question_done', questionId: q.id, answerLength: q.answer.length });

  return { question: q, searchCount };
}
