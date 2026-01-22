/**
 * Document Edit Types
 * Schema for edit operations on ResearchDoc sections
 */

import { z } from 'zod';
import { SourceSchema, StrategySchema, SectionItemSchema } from './research-doc';

/**
 * Edit action types
 * - add_items: Add new items to a section
 * - remove_items: Remove items by id
 * - replace_all: Replace all items in section (for consolidation)
 */
export const EditActionSchema = z.enum(['add_items', 'remove_items', 'replace_all']);

export type EditAction = z.infer<typeof EditActionSchema>;

/**
 * Single edit operation on a document section
 */
export const DocEditSchema = z.object({
  action: EditActionSchema,
  sectionTitle: z.string(),
  items: z.array(z.object({
    text: z.string(),
    sources: z.array(SourceSchema).optional(),
  })).optional(),  // For add_items and replace_all
  itemIds: z.array(z.string()).optional(),  // For remove_items
});

export type DocEdit = z.infer<typeof DocEditSchema>;

/**
 * Output from the Reflection Agent
 * Contains edit operations, strategy updates, and continuation decision
 */
export const ReflectionOutputSchema = z.object({
  documentEdits: z.array(DocEditSchema),
  strategyUpdate: StrategySchema.optional(),
  shouldContinue: z.boolean(),
  reasoning: z.string(),       // Why these edits
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

/**
 * Raw findings from the Search Agent
 * These are disposable - not persisted directly to the document
 */
export const SearchFindingsSchema = z.object({
  queries: z.array(z.object({
    query: z.string(),
    purpose: z.string(),
    answer: z.string(),
    sources: z.array(SourceSchema),
    status: z.enum(['success', 'error', 'no_results']),
  })),
  summary: z.string().optional(),
});

export type SearchFindings = z.infer<typeof SearchFindingsSchema>;

/**
 * Input for the Search Agent
 */
export const SearchTaskSchema = z.object({
  task: z.string(),           // What to search for (from strategy.nextActions)
  context: z.string(),        // Current document state for context
  objective: z.string(),      // The research objective
  doneWhen: z.string(),       // The stopping condition
  previousQueries: z.array(z.string()), // For deduplication
});

export type SearchTask = z.infer<typeof SearchTaskSchema>;

/**
 * Input for the Reflection Agent
 */
export const ReflectionInputSchema = z.object({
  currentDoc: z.string(),     // Formatted document for context
  rawFindings: SearchFindingsSchema,
  objective: z.string(),
  doneWhen: z.string(),
});

export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;
