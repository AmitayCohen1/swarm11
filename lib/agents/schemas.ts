import { z } from 'zod';

/**
 * Zod Schemas for AI SDK generateObject
 */

// Research agent output schema
export const ResearchAgentOutputSchema = z.object({
  thinking: z.string().describe('Your research strategy and planning. What information do you need and why?'),
  decision: z.enum(['CONTINUE', 'SYNTHESIZE', 'ASK']).describe('CONTINUE = need more searches, SYNTHESIZE = ready to create final answer, ASK = need user input'),
  reasoning: z.string().describe('Explanation of why you made this decision'),
  nextQueries: z.array(z.string()).optional().describe('If CONTINUE: list 3-5 specific search queries to execute next'),
  question: z.string().optional().describe('If ASK: the clarifying question to ask the user'),
});

export type ResearchAgentOutput = z.infer<typeof ResearchAgentOutputSchema>;

// Casual response schema
export const CasualResponseSchema = z.object({
  response: z.string().describe('Your conversational response to the user'),
});

export type CasualResponse = z.infer<typeof CasualResponseSchema>;

// Synthesis output schema
export const SynthesisOutputSchema = z.object({
  answer: z.string().describe('Comprehensive answer in markdown format with inline citations like [1], [2], [3]'),
  sources: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      url: z.string(),
    })
  ),
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
