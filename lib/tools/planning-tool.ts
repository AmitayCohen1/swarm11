import { z } from 'zod';

export const createResearchPlan = {
  description: 'Create a structured research plan by generating 3-5 specific research questions. Use this FIRST before conducting any research to ensure you have a clear strategy.',

  inputSchema: z.object({
    strategy: z.string().describe('Your overall research strategy and approach'),
    questions: z.array(z.string()).min(3).max(5).describe('3-5 specific, focused research questions you will investigate'),
    reasoning: z.string().describe('Why these questions will comprehensively address the objective')
  }),

  execute: async ({ strategy, questions, reasoning }: {
    strategy: string;
    questions: string[];
    reasoning: string;
  }) => {
    return {
      success: true,
      strategy,
      questions,
      reasoning,
      questionsCount: questions.length,
      timestamp: new Date().toISOString()
    };
  }
};

export const summarizeFindings = {
  description: 'Summarize and synthesize all research findings collected so far. Use this periodically to consolidate knowledge and identify gaps.',

  inputSchema: z.object({
    summary: z.string().describe('Comprehensive summary of all findings so far in markdown format'),
    keyInsights: z.array(z.string()).describe('3-5 key insights or discoveries'),
    gaps: z.array(z.string()).optional().describe('Knowledge gaps that still need to be filled'),
    nextSteps: z.array(z.string()).optional().describe('Suggested next research steps')
  }),

  execute: async ({ summary, keyInsights, gaps, nextSteps }: {
    summary: string;
    keyInsights: string[];
    gaps?: string[];
    nextSteps?: string[];
  }) => {
    return {
      success: true,
      summary,
      keyInsights,
      gaps: gaps || [],
      nextSteps: nextSteps || [],
      timestamp: new Date().toISOString()
    };
  }
};
