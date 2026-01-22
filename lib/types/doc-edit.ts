/**
 * Document Edit Types - Version 4
 * Item-based operations: add, remove, edit
 */

import { z } from 'zod';
import { SourceSchema, StrategySchema } from './research-doc';

/**
 * Single edit operation on a section
 */
export const DocEditSchema = z.object({
  action: z.enum(['add_item', 'remove_item', 'edit_item']),
  sectionTitle: z.string(),      // Section to operate on (created if doesn't exist)
  itemId: z.string().optional(), // Required for remove/edit
  content: z.string().optional(), // Required for add/edit
  sources: z.array(SourceSchema).optional(), // For add/edit
});

export type DocEdit = z.infer<typeof DocEditSchema>;

/**
 * Output from the Reflection Agent
 */
export const ReflectionOutputSchema = z.object({
  edits: z.array(DocEditSchema),
  strategyUpdate: StrategySchema.optional(),
  shouldContinue: z.boolean(),
  reasoning: z.string(),
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

/**
 * Raw findings from the Search Agent
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
  task: z.string(),
  context: z.string(),
  objective: z.string(),
  doneWhen: z.string(),
  previousQueries: z.array(z.string()),
});

export type SearchTask = z.infer<typeof SearchTaskSchema>;

/**
 * Input for the Reflection Agent
 */
export const ReflectionInputSchema = z.object({
  currentDoc: z.string(),
  rawFindings: SearchFindingsSchema,
  objective: z.string(),
  doneWhen: z.string(),
});

export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;
