/**
 * Brain - Cortex-level evaluate/finish cycle
 *
 * Same pattern as researcher:
 *   evaluate(state) → continue or done?
 *   finish(state) → produce output
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ResearchQuestionMemory } from './types';
import { createQuestion } from './types';

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const QuestionSchema = z.object({
  question: z.string().describe('Short, precise question (max 15 words)'),
  description: z.string().describe('Why this helps the objective (1-2 sentences)'),
  goal: z.string().describe('Realistic, measurable, specific goal (e.g., "Find 3 company names", "Get price range", "Yes/no answer")'),
});

const EvaluateSchema = z.object({
  reasoning: z.string().describe('Analysis of current state'),
  decision: z.enum(['continue', 'done']),
  questions: z.array(QuestionSchema).max(5).describe('Questions to research (empty array if decision is done)'),
});

const FinishSchema = z.object({
  answer: z.string().describe('Complete answer to the research objective'),
});

// ============================================================
// Evaluate - Look at completed questions, decide continue/done
// ============================================================

export interface EvaluateResult {
  reasoning: string;
  decision: 'continue' | 'done';
  questions?: ResearchQuestionMemory[];
}

export async function evaluate(
  objective: string,
  completedQuestions: ResearchQuestionMemory[]
): Promise<EvaluateResult> {
  const questionsContext = completedQuestions.length > 0
    ? completedQuestions.map(q =>
        `### ${q.question}\n**Confidence:** ${q.confidence || 'unknown'}\n**Answer:** ${q.answer || 'No answer'}`
      ).join('\n\n')
    : '(No research completed yet)';

  const result = await generateText({
    model,
    // PROMPT GOAL (Brain.evaluate): Decide whether to continue researching, and if so, which questions to run next.
    // Input = objective + completed question summaries. Output = { decision, reasoning, questions[] }.
    // Important: Brain does NOT search the web. It only plans/decides.
    prompt: `You are the brain of a research system. You look at the current state and decide what to do next.

OBJECTIVE: ${objective}

## Completed Research (${completedQuestions.length} questions)

${questionsContext}

## Your Task

Based on what we have, decide:
- If we need research (no questions yet, or gaps remain): decision = "continue" and provide questions
- If we have enough to answer the user: decision = "done"

Each question runs in parallel by a separate researcher (they don't share context).

Important: Each question needs a realistic, measurable, specific goal - something the researcher can actually find and check off.`,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

  return {
    reasoning: data.reasoning,
    decision: data.decision,
    questions: data.questions.length > 0
      ? data.questions.map(q => createQuestion(q.question, q.description, q.goal))
      : undefined,
  };
}

// ============================================================
// Finish - Combine all findings into final answer
// ============================================================

export interface FinishResult {
  answer: string;
}

export async function finish(
  objective: string,
  completedQuestions: ResearchQuestionMemory[]
): Promise<FinishResult> {
  const questionsContext = completedQuestions.map(q =>
    `### ${q.question}\n**Confidence:** ${q.confidence || 'unknown'}\n${q.answer || 'No answer'}`
  ).join('\n\n---\n\n');

  const result = await generateText({
    model,
    // PROMPT GOAL (Brain.finish): Write the final user-facing answer from completed question summaries.
    // Output = { answer } only (no citations/sources are plumbed through today).
    prompt: `You are part of a research system. You are the final step - the writer. Researchers have gathered information, and now you write the final answer that goes to the user.

OBJECTIVE: ${objective}

## Research Findings

${questionsContext}

Write a final answer that gives the user what they asked for. Be specific and practical.`,
    output: Output.object({ schema: FinishSchema }),
  });

  return { answer: (result.output as z.infer<typeof FinishSchema>).answer };
}
