/**
 * Initiative Document Types - Cortex Architecture
 * Parallel initiative-based research system
 */

import { z } from 'zod';
import { FindingSchema, SourceSchema } from './research-doc';

// Re-export Finding type for convenience
export type { Finding, Source } from './research-doc';

/**
 * Initiative status
 */
export const InitiativeStatusSchema = z.enum(['pending', 'running', 'done']);
export type InitiativeStatus = z.infer<typeof InitiativeStatusSchema>;

/**
 * Initiative confidence level
 */
export const InitiativeConfidenceSchema = z.enum(['low', 'medium', 'high']).nullable();
export type InitiativeConfidence = z.infer<typeof InitiativeConfidenceSchema>;

/**
 * Initiative recommendation
 */
export const InitiativeRecommendationSchema = z.enum(['promising', 'dead_end', 'needs_more']).nullable();
export type InitiativeRecommendation = z.infer<typeof InitiativeRecommendationSchema>;

/**
 * Search result - query + answer + learned + nextAction
 */
export const SearchResultSchema = z.object({
  query: z.string(),
  answer: z.string(),
  learned: z.string().optional(),                // What we learned from this search
  nextAction: z.string().optional(),             // What we plan to do next
  sources: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
  })).default([]),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Cycle reflection - what was learned and what's next
 */
export const CycleReflectionSchema = z.object({
  cycle: z.number(),
  learned: z.string(),           // "Found 3 training vendors with audio content"
  nextStep: z.string(),          // "Will search for contact info" or "Have enough, finishing"
  status: z.enum(['continue', 'done']),
});
export type CycleReflection = z.infer<typeof CycleReflectionSchema>;

/**
 * Single initiative - explores one research angle
 */
export const InitiativeSchema = z.object({
  id: z.string(),                                  // init_xxx
  name: z.string(),                                // Short name (e.g., "Corporate Training Providers")
  description: z.string(),                         // What this initiative is about and why it matters
  goal: z.string(),                                // What we're looking to achieve/answer
  status: InitiativeStatusSchema.default('pending'),
  cycles: z.number().default(0),                   // How many research→reflect loops
  maxCycles: z.number().default(10),               // Cap (default 10)
  findings: z.array(FindingSchema).default([]),    // Accumulated facts
  searchResults: z.array(SearchResultSchema).default([]), // Full search results with answers
  reflections: z.array(CycleReflectionSchema).default([]), // What was learned each cycle
  confidence: InitiativeConfidenceSchema.default(null),
  recommendation: InitiativeRecommendationSchema.default(null),
  summary: z.string().optional(),                  // Final summary when done
});

export type Initiative = z.infer<typeof InitiativeSchema>;

/**
 * Cortex decision action types
 */
export const CortexActionSchema = z.enum(['spawn', 'drill_down', 'kill', 'synthesize']);
export type CortexAction = z.infer<typeof CortexActionSchema>;

/**
 * Cortex decision log entry
 */
export const CortexDecisionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: CortexActionSchema,
  initiativeId: z.string().optional(),
  reasoning: z.string(),
});

export type CortexDecision = z.infer<typeof CortexDecisionSchema>;

/**
 * Cortex document status
 */
export const CortexStatusSchema = z.enum(['running', 'synthesizing', 'complete']);
export type CortexStatus = z.infer<typeof CortexStatusSchema>;

/**
 * Top-level research state - CortexDoc
 */
export const CortexDocSchema = z.object({
  version: z.literal(1),
  objective: z.string(),
  successCriteria: z.array(z.string()),
  initiatives: z.array(InitiativeSchema).default([]),
  cortexLog: z.array(CortexDecisionSchema).default([]),  // History of cortex decisions
  status: CortexStatusSchema.default('running'),
  finalAnswer: z.string().optional(),
});

export type CortexDoc = z.infer<typeof CortexDocSchema>;

// ============================================================
// ID Generators
// ============================================================

/**
 * Generate initiative ID
 */
export function generateInitiativeId(): string {
  return `init_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate cortex decision ID
 */
export function generateCortexDecisionId(): string {
  return `cdec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate finding ID (re-export for convenience)
 */
export function generateFindingId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a new initiative
 */
export function createInitiative(
  name: string,
  description: string,
  goal: string,
  maxCycles: number = 10
): Initiative {
  return {
    id: generateInitiativeId(),
    name,
    description,
    goal,
    status: 'pending',
    cycles: 0,
    maxCycles,
    findings: [],
    searchResults: [],
    reflections: [],
    confidence: null,
    recommendation: null,
  };
}

/**
 * Create a cortex decision entry
 */
export function createCortexDecision(
  action: CortexAction,
  reasoning: string,
  initiativeId?: string
): CortexDecision {
  return {
    id: generateCortexDecisionId(),
    timestamp: new Date().toISOString(),
    action,
    initiativeId,
    reasoning,
  };
}

/**
 * Create a new CortexDoc
 */
export function createCortexDoc(
  objective: string,
  successCriteria: string[]
): CortexDoc {
  return {
    version: 1,
    objective,
    successCriteria,
    initiatives: [],
    cortexLog: [],
    status: 'running',
  };
}
