import { tool } from 'ai';
import { z } from 'zod';

export const completionTool = tool({
  description: 'Signal that the research objective is COMPLETE and you have gathered sufficient information. Call this ONLY when you actively decide the goal is achieved, NOT when running out of credits or iterations. This tool represents an active decision that the research is done.',

  inputSchema: z.object({
    reasoning: z.string().describe('Detailed explanation of why you believe the research is complete and the objective is fully achieved'),
    confidenceLevel: z.enum(['low', 'medium', 'high']).describe('Your confidence in the completeness and quality of the findings'),
    keyFindings: z.array(z.string()).optional().describe('3-5 key findings or insights discovered during research')
  }),

  execute: async ({ reasoning, confidenceLevel, keyFindings }) => {
    // This tool is ONLY for goal achievement, NOT for resource limits
    // Credits/iterations are handled automatically by the agent loop
    return {
      completed: true,
      reasoning,
      confidenceLevel,
      keyFindings: keyFindings || [],
      timestamp: new Date().toISOString()
    };
  }
});
