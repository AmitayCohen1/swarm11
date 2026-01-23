/**
 * Research Document Types - Version 8
 * Phased research with sequential steps
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
 * Individual finding/result
 */
export const FindingSchema = z.object({
  id: z.string(),
  content: z.string(),
  sources: z.array(SourceSchema).default([]),
  status: z.enum(['active', 'disqualified']).default('active'),
  disqualifyReason: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * Research Phase - a step in the research plan
 */
export const ResearchPhaseSchema = z.object({
  id: z.string(),
  title: z.string(),  // e.g., "Understand the landscape"
  goal: z.string(),   // What we're trying to learn in this phase
  status: z.enum(['not_started', 'in_progress', 'done']).default('not_started'),
  findings: z.array(FindingSchema).default([]),
});

export type ResearchPhase = z.infer<typeof ResearchPhaseSchema>;

/**
 * Strategy entry (single point in time)
 */
export const StrategySchema = z.object({
  approach: z.string(),
  rationale: z.string(),
  nextActions: z.array(z.string()),
});

export type Strategy = z.infer<typeof StrategySchema>;

/**
 * Strategy log entry with timestamp
 */
export const StrategyLogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  approach: z.string(),
  rationale: z.string(),
  nextActions: z.array(z.string()),
});

export type StrategyLogEntry = z.infer<typeof StrategyLogEntrySchema>;

/**
 * Research Document v8
 */
export const ResearchDocSchema = z.object({
  version: z.literal(8),
  objective: z.string(),
  phases: z.array(ResearchPhaseSchema).default([]),
  strategyLog: z.array(StrategyLogEntrySchema).default([]),
  queriesRun: z.array(z.string()),
  lastUpdated: z.string(),
});

export type ResearchDoc = z.infer<typeof ResearchDocSchema>;

/**
 * Generate phase ID
 */
export function generatePhaseId(): string {
  return `phase_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate finding ID
 */
export function generateFindingId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate strategy log entry ID
 */
export function generateStrategyId(): string {
  return `strat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Create initial strategy log entry
 */
export function createInitialStrategyEntry(objective: string): StrategyLogEntry {
  return {
    id: generateStrategyId(),
    timestamp: new Date().toISOString(),
    approach: 'Starting research',
    rationale: `Initial approach to investigate: ${objective}`,
    nextActions: ['Work through research phases'],
  };
}

/**
 * Create strategy log entry from strategy update
 */
export function createStrategyEntry(strategy: Strategy): StrategyLogEntry {
  return {
    id: generateStrategyId(),
    timestamp: new Date().toISOString(),
    ...strategy,
  };
}

/**
 * Create a new research phase
 */
export function createResearchPhase(title: string, goal: string): ResearchPhase {
  return {
    id: generatePhaseId(),
    title,
    goal,
    status: 'not_started',
    findings: [],
  };
}
