/**
 * Research Document Types - Version 4
 * Item-based sections with add/remove/edit operations
 */

import { z } from 'zod';

/**
 * Source reference
 */
export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
});

export type Source = z.infer<typeof SourceSchema>;

/**
 * Individual item within a section
 */
export const SectionItemSchema = z.object({
  id: z.string(),
  content: z.string(),  // Markdown content
  sources: z.array(SourceSchema).default([]),
});

export type SectionItem = z.infer<typeof SectionItemSchema>;

/**
 * Section - contains items
 */
export const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  items: z.array(SectionItemSchema).default([]),
});

export type Section = z.infer<typeof SectionSchema>;

/**
 * Research strategy
 */
export const StrategySchema = z.object({
  approach: z.string(),
  rationale: z.string(),
  nextActions: z.array(z.string()),
});

export type Strategy = z.infer<typeof StrategySchema>;

/**
 * Research Document v4
 */
export const ResearchDocSchema = z.object({
  version: z.literal(4),
  objective: z.string(),
  doneWhen: z.string(),
  sections: z.array(SectionSchema),
  strategy: StrategySchema,
  queriesRun: z.array(z.string()),
  lastUpdated: z.string(),
});

export type ResearchDoc = z.infer<typeof ResearchDocSchema>;

/**
 * Generate section ID
 */
export function generateSectionId(): string {
  return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate item ID
 */
export function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Create initial strategy
 */
export function createInitialStrategy(objective: string): Strategy {
  return {
    approach: 'Starting research',
    rationale: `Initial approach to investigate: ${objective}`,
    nextActions: ['Perform initial search to understand the landscape'],
  };
}
