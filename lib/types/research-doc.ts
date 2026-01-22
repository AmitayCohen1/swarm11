/**
 * Research Document Types - Version 3
 * Document-centric research architecture: structured JSON as source of truth.
 */

import { z } from 'zod';

/**
 * Source reference for citations
 */
export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
});

export type Source = z.infer<typeof SourceSchema>;

/**
 * Individual item within a section (finding, question, note, etc.)
 */
export const SectionItemSchema = z.object({
  id: z.string(),
  text: z.string(),                              // Main content
  sources: z.array(SourceSchema).optional(),     // Supporting sources
});

export type SectionItem = z.infer<typeof SectionItemSchema>;

/**
 * Generate a stable item ID
 */
export function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Section within the research document
 * Agents target sections by TITLE (human-readable)
 */
export const SectionSchema = z.object({
  id: z.string(),              // Stable internal ID
  title: z.string(),           // Human-facing title
  items: z.array(SectionItemSchema).default([]),  // Structured items
  lastUpdated: z.string(),     // ISO timestamp
});

export type Section = z.infer<typeof SectionSchema>;

/**
 * Research strategy - updated by Reflection Agent
 */
export const StrategySchema = z.object({
  approach: z.string(),        // Current research approach
  rationale: z.string(),       // Why this approach
  nextActions: z.array(z.string()), // What to do next
});

export type Strategy = z.infer<typeof StrategySchema>;

/**
 * Research Document v3 - Document-centric architecture
 * The document is the single source of truth, not logs
 */
export const ResearchDocSchema = z.object({
  version: z.literal(3),

  // North Star (rarely changes)
  northStar: z.string(),       // High-level success definition
  currentObjective: z.string(), // What we're trying to find
  doneWhen: z.string(),        // Hard stopping condition

  // Structured sections (editable by title)
  sections: z.array(SectionSchema),

  // Strategy (updated by Reflection Agent)
  strategy: StrategySchema,

  // Metadata
  queriesRun: z.array(z.string()), // For deduplication
  lastUpdated: z.string(),
});

export type ResearchDoc = z.infer<typeof ResearchDocSchema>;

/**
 * Default section titles
 */
export const DEFAULT_SECTION_TITLES = {
  KEY_FINDINGS: 'Key Findings',
  OPEN_QUESTIONS: 'Open Questions',
  DEAD_ENDS: 'Dead Ends',
  RAW_NOTES: 'Raw Notes',
} as const;

/**
 * Generate a stable section ID
 */
export function generateSectionId(): string {
  return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default sections for a new research document
 */
export function createDefaultSections(): Section[] {
  const now = new Date().toISOString();
  return [
    {
      id: generateSectionId(),
      title: DEFAULT_SECTION_TITLES.KEY_FINDINGS,
      items: [],
      lastUpdated: now,
    },
    {
      id: generateSectionId(),
      title: DEFAULT_SECTION_TITLES.OPEN_QUESTIONS,
      items: [],
      lastUpdated: now,
    },
    {
      id: generateSectionId(),
      title: DEFAULT_SECTION_TITLES.DEAD_ENDS,
      items: [],
      lastUpdated: now,
    },
    {
      id: generateSectionId(),
      title: DEFAULT_SECTION_TITLES.RAW_NOTES,
      items: [],
      lastUpdated: now,
    },
  ];
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
