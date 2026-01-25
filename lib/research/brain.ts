/**
 * Brain - Strategic planning and evaluation
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { CortexMemory, ResearchQuestionMemory } from './types';
import { createQuestion } from './types';

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const QuestionSchema = z.object({
  question: z.string().describe('Short, precise question (max 15 words)'),
  description: z.string().describe('Why this helps the objective (1-2 sentences)'),
  goal: z.string().describe('Specific goal - what marks this as answered'),
});

const KickoffSchema = z.object({
  reasoning: z.string().describe('Strategy for tackling the research'),
  questions: z.array(QuestionSchema),
});

const EvaluateSchema = z.object({
  reasoning: z.string().describe('What we learned and what gaps remain'),
  decision: z.enum(['spawn', 'synthesize']),
  questions: z.array(QuestionSchema).max(5).optional(),
});

const SynthesizeSchema = z.object({
  finalAnswer: z.string().describe('Complete answer to the research objective'),
});

// ============================================================
// Kickoff - Generate initial questions
// ============================================================

export interface KickoffResult {
  reasoning: string;
  questions: ResearchQuestionMemory[];
}

export async function kickoff(cortex: CortexMemory): Promise<KickoffResult> {
  const result = await generateText({
    model,
    prompt: `You are part of a research system. You are the planner - you run first to break down the user's objective into questions. Then separate researchers will search the web to answer each question in parallel.

OBJECTIVE: ${cortex.objective}

Generate research questions that directly work toward this objective.
Each question runs in parallel by a separate researcher (they don't share context).`,
    output: Output.object({ schema: KickoffSchema }),
  });

  const data = result.output as z.infer<typeof KickoffSchema>;
  const questions = data.questions.map(q => createQuestion(q.question, q.description, q.goal));

  return { reasoning: data.reasoning, questions };
}

// ============================================================
// Evaluate - Decide next action based on completed questions
// ============================================================

export interface EvaluateResult {
  reasoning: string;
  decision: 'spawn' | 'synthesize';
  questions?: ResearchQuestionMemory[];
}

export async function evaluate(
  cortex: CortexMemory,
  questions: Record<string, ResearchQuestionMemory>
): Promise<EvaluateResult> {
  const completed = Object.values(questions).filter(q => q.status === 'done');
  const questionsContext = completed.map(q =>
    `### ${q.question}\n**Confidence:** ${q.confidence || 'unknown'}\n**Answer:** ${q.answer || 'No answer'}`
  ).join('\n\n');

  const result = await generateText({
    model,
    prompt: `You are part of a research system. Researchers have finished answering questions. Now you decide: do we have enough to answer the user, or do we need more research?

OBJECTIVE: ${cortex.objective}

## Completed Research (${completed.length} questions)

${questionsContext}

## Your Task

Do we have enough to give the user a useful answer?

- If YES: decision = "synthesize" (next step: writer creates final answer)
- If NO: decision = "spawn" and provide new questions (next step: researchers answer them)`,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

  return {
    reasoning: data.reasoning,
    decision: data.decision,
    questions: data.questions?.map(q => createQuestion(q.question, q.description, q.goal)),
  };
}

// ============================================================
// Synthesize - Write final answer
// ============================================================

export async function synthesize(
  cortex: CortexMemory,
  questions: Record<string, ResearchQuestionMemory>
): Promise<string> {
  const completed = Object.values(questions).filter(q => q.status === 'done');
  const questionsContext = completed.map(q =>
    `### ${q.question}\n**Confidence:** ${q.confidence || 'unknown'}\n${q.answer || 'No answer'}`
  ).join('\n\n---\n\n');

  const result = await generateText({
    model,
    prompt: `You are part of a research system. You are the final step - the writer. Researchers have gathered information, and now you write the final answer that goes to the user.

Our main objective is: ${cortex.objective}

## Research Findings

${questionsContext}

Write a final answer that gives the user what they asked for. Be specific and practical.`,
    output: Output.object({ schema: SynthesizeSchema }),
  });

  return (result.output as z.infer<typeof SynthesizeSchema>).finalAnswer;
}
