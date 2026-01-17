import { z } from 'zod';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export function createBrainTool(sessionId: string) {
  return {
    description: 'Update the knowledge brain with new findings. Use this after each research query to accumulate knowledge in a structured markdown document. This is your research notebook - update it frequently to track progress and organize information by topic/theme.',

    inputSchema: z.object({
      findings: z.string().describe('The new findings to add to the brain. Be comprehensive and well-structured.'),
      category: z.string().optional().describe('Category or topic for organizing findings (e.g., "Market Analysis", "Competitor Research")')
    }),

    execute: async ({ findings, category }: { findings: string; category?: string }) => {
      // Get current brain
      const [session] = await db
        .select({ brain: autonomousSessions.brain })
        .from(autonomousSessions)
        .where(eq(autonomousSessions.id, sessionId));

      const currentBrain = session?.brain || '';

      // Append new findings with structure
      const timestamp = new Date().toLocaleString();
      const newEntry = `\n\n## ${category || 'Research Finding'} (${timestamp})\n\n${findings}\n`;
      const updatedBrain = currentBrain + newEntry;

      // Check if brain is getting too large (>50KB)
      const brainSizeWarning = updatedBrain.length > 50000
        ? ' (Warning: Brain is getting large, consider summarizing in future iterations)'
        : '';

      // Save to database using proper SQL helper
      await db
        .update(autonomousSessions)
        .set({
          brain: updatedBrain,
          queriesExecuted: sql`${autonomousSessions.queriesExecuted} + 1`,
          updatedAt: new Date()
        })
        .where(eq(autonomousSessions.id, sessionId));

      return {
        success: true,
        brainSize: updatedBrain.length,
        message: `Brain updated with new findings${brainSizeWarning}`,
        category: category || 'Research Finding'
      };
    }
  };
}
