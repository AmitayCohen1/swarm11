/**
 * Document Edit Types - Version 7
 * Question-based operations: add question, add finding, mark done, disqualify
 */

import { z } from 'zod';
import { SourceSchema, StrategySchema } from './research-doc';

/**
 * Single edit operation on the research document
 */
export const DocEditSchema = z.object({
  action: z.enum([
    'add_question',      // Add a new research question
    'add_finding',       // Add a finding to a question
    'edit_finding',      // Edit an existing finding
    'remove_finding',    // Remove a finding
    'disqualify_finding', // Mark a finding as disqualified
    'mark_question_done', // Mark a question as done
  ]),
  questionId: z.string().optional(),   // Required for finding operations
  questionText: z.string().optional(), // Required for add_question
  findingId: z.string().optional(),    // Required for edit/remove/disqualify finding
  content: z.string().optional(),      // Required for add/edit finding
  sources: z.array(SourceSchema).optional(),
  disqualifyReason: z.string().optional(), // Required for disqualify_finding
});

export type DocEdit = z.infer<typeof DocEditSchema>;

/**
 * Output from reflection/review
 */
export const ReflectionOutputSchema = z.object({
  edits: z.array(DocEditSchema),
  strategyUpdate: StrategySchema.optional(),
  shouldContinue: z.boolean(),
  reasoning: z.string(),
});

export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;
