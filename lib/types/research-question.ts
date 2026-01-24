/**
 * ResearchQuestion Document Types - Cortex Architecture
 * Parallel question-based research system
 */

import { z } from 'zod';
import { FindingSchema, SourceSchema } from './research-doc';

// Re-export Finding type for convenience
export type { Finding, Source } from './research-doc';

/**
 * ResearchQuestion status
 */
export const ResearchQuestionStatusSchema = z.enum(['pending', 'running', 'done']);
export type ResearchQuestionStatus = z.infer<typeof ResearchQuestionStatusSchema>;

/**
 * ResearchQuestion confidence level
 */
export const ResearchQuestionConfidenceSchema = z.enum(['low', 'medium', 'high']).nullable();
export type ResearchQuestionConfidence = z.infer<typeof ResearchQuestionConfidenceSchema>;

/**
 * ResearchQuestion recommendation
 */
export const ResearchQuestionRecommendationSchema = z.enum(['promising', 'dead_end', 'needs_more']).nullable();
export type ResearchQuestionRecommendation = z.infer<typeof ResearchQuestionRecommendationSchema>;

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
 * Episode memory - one search→reflect step distilled into structured state.
 * This is the primary unit Cortex should reason over (not raw chat messages).
 */
export const EpisodeDeltaTypeSchema = z.enum(['progress', 'no_change', 'dead_end']);
export type EpisodeDeltaType = z.infer<typeof EpisodeDeltaTypeSchema>;

export const EpisodeSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  cycle: z.number(),

  // The action we took
  query: z.string(),
  purpose: z.string().default(''),
  sources: z.array(z.object({ url: z.string(), title: z.string().optional() })).default([]),

  // The interpretation
  learned: z.string(),
  stillNeed: z.string().default(''),
  deltaType: EpisodeDeltaTypeSchema,
  delta: z.string().default(''),

  // Guardrails / anti-looping
  dontRepeat: z.array(z.string()).default([]),

  // Decision
  nextStep: z.string().default(''),
  status: z.enum(['continue', 'done']),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/**
 * Single research question - explores one angle of the research
 */
export const ResearchQuestionSchema = z.object({
  id: z.string(),                                  // q_xxx
  title: z.string().optional(),                    // Short tab title (3–5 words). Defaults to `name`.
  name: z.string(),                                // Short label/category (2-5 words). Historically used for tabs.
  question: z.string(),                            // The research question (e.g., "Which podcast networks produce fact-heavy content?")
  goal: z.string(),                                // What we're looking to find out
  status: ResearchQuestionStatusSchema.default('pending'),
  cycles: z.number().default(0),                   // How many research→reflect loops
  maxCycles: z.number().default(10),               // Cap (default 10)
  findings: z.array(FindingSchema).default([]),    // Accumulated facts
  searchResults: z.array(SearchResultSchema).default([]), // Full search results with answers
  reflections: z.array(CycleReflectionSchema).default([]), // What was learned each cycle
  episodes: z.array(EpisodeSchema).default([]),    // Episode memory (structured deltas)
  confidence: ResearchQuestionConfidenceSchema.default(null),
  recommendation: ResearchQuestionRecommendationSchema.default(null),
  summary: z.string().optional(),                  // Final summary when done
});

export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

/**
 * Cortex decision action types
 */
export const CortexActionSchema = z.enum(['spawn', 'synthesize']);
export type CortexAction = z.infer<typeof CortexActionSchema>;

/**
 * Cortex decision log entry
 */
export const CortexDecisionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: CortexActionSchema,
  questionId: z.string().optional(),
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
  questions: z.array(ResearchQuestionSchema).default([]),
  cortexLog: z.array(CortexDecisionSchema).default([]),  // History of cortex decisions
  status: CortexStatusSchema.default('running'),
  finalAnswer: z.string().optional(),
});

export type CortexDoc = z.infer<typeof CortexDocSchema>;

// ============================================================
// ID Generators
// ============================================================

/**
 * Generate question ID
 */
export function generateResearchQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate cortex decision ID
 */
export function generateCortexDecisionId(): string {
  return `cdec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Generate episode ID
 */
export function generateEpisodeId(): string {
  return `ep_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
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
 * Create a new question
 */
export function createResearchQuestion(
  name: string,
  question: string,
  goal: string,
  maxCycles: number = 10
): ResearchQuestion {
  return {
    id: generateResearchQuestionId(),
    title: name,
    name,
    question,
    goal,
    status: 'pending',
    cycles: 0,
    maxCycles,
    findings: [],
    searchResults: [],
    reflections: [],
    episodes: [],
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
  questionId?: string
): CortexDecision {
  return {
    id: generateCortexDecisionId(),
    timestamp: new Date().toISOString(),
    action,
    questionId,
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
    questions: [],
    cortexLog: [],
    status: 'running',
  };
}
