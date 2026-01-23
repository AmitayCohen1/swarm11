/**
 * Research Document Types - Version 7
 * Research Questions with findings
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
  content: z.string(),  // Short fact
  sources: z.array(SourceSchema).default([]),
  status: z.enum(['active', 'disqualified']).default('active'),
  disqualifyReason: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * Research Question - a question we're trying to answer
 */
export const ResearchQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),  // e.g., "Who are the top DevRel candidates?"
  status: z.enum(['open', 'done']).default('open'),
  findings: z.array(FindingSchema).default([]),  // Results for this question
});

export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

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
 * Research Document v7
 */
export const ResearchDocSchema = z.object({
  version: z.literal(7),
  objective: z.string(),
  researchQuestions: z.array(ResearchQuestionSchema).default([]),
  strategyLog: z.array(StrategyLogEntrySchema).default([]),
  queriesRun: z.array(z.string()),
  lastUpdated: z.string(),
});

export type ResearchDoc = z.infer<typeof ResearchDocSchema>;

/**
 * Generate question ID
 */
export function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
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
    nextActions: ['Form initial research questions'],
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
 * Create a new research question
 */
export function createResearchQuestion(question: string): ResearchQuestion {
  return {
    id: generateQuestionId(),
    question,
    status: 'open',
    findings: [],
  };
}
