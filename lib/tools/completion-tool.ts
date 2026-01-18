import { tool } from 'ai';
import { z } from 'zod';

export const completionTool = tool({
  description: 'Signal that the research objective is COMPLETE and you have gathered sufficient information. Call this ONLY when you actively decide the goal is achieved, NOT when running out of credits or iterations. This tool represents an active decision that the research is done.',

  inputSchema: z.object({
    reasoning: z.string().describe('Detailed explanation of why you believe the research is complete and the objective is fully achieved'),
    confidenceLevel: z.enum(['low', 'medium', 'high']).describe('Your confidence in the completeness and quality of the findings'),
    keyFindings: z.array(z.string()).min(1).max(10).optional().describe('Key findings the user can act on (bullet points, specific)'),
    recommendedActions: z.array(z.string()).min(1).max(10).optional().describe('Concrete next steps the user should take (bullet points)'),
    sourcesUsed: z.array(z.object({
      title: z.string().optional(),
      url: z.string()
    })).min(1).max(20).optional().describe('Citations for the most important claims (URLs). Prefer primary sources.'),
    finalAnswerMarkdown: z.string().optional().describe('Your final deliverable to the user, in Markdown. Must be concise, actionable, and cite sources when relevant.')
  }),

  execute: async ({ reasoning, confidenceLevel, keyFindings, recommendedActions, sourcesUsed, finalAnswerMarkdown }) => {
    // This tool is ONLY for goal achievement, NOT for resource limits
    // Credits/iterations are handled automatically by the agent loop
    return {
      completed: true,
      reasoning,
      confidenceLevel,
      keyFindings: keyFindings || [],
      recommendedActions: recommendedActions || [],
      sourcesUsed: sourcesUsed || [],
      finalAnswerMarkdown: finalAnswerMarkdown || '',
      timestamp: new Date().toISOString()
    };
  }
});
