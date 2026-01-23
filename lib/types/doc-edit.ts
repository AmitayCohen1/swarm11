/**
 * Document Edit Types - Version 8
 * Phase-based operations
 */

import { z } from 'zod';
import { SourceSchema, StrategySchema } from './research-doc';

/**
 * Single edit operation on the research document
 */
export const DocEditSchema = z.object({
  action: z.enum([
    'add_phase',           // Add a new research phase
    'start_phase',         // Mark phase as in_progress
    'complete_phase',      // Mark phase as done
    'add_finding',         // Add a finding to a phase
    'edit_finding',        // Edit an existing finding
    'remove_finding',      // Remove a finding
    'disqualify_finding',  // Mark a finding as disqualified
  ]),
  phaseId: z.string().optional(),      // Required for phase operations
  phaseTitle: z.string().optional(),   // Required for add_phase
  phaseGoal: z.string().optional(),    // Required for add_phase
  findingId: z.string().optional(),    // Required for finding edit/remove/disqualify
  content: z.string().optional(),      // Required for add/edit finding
  sources: z.array(SourceSchema).optional(),
  disqualifyReason: z.string().optional(),
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
