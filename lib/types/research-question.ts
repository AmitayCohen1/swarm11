/**
 * Research System Types
 * Parallel question-based research system with Brain + Researcher agents
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
export const SearchSchema = z.object({
  query: z.string(),
  answer: z.string(),
  learned: z.string().optional(),                // What we learned from this search
  nextAction: z.string().optional(),             // What we plan to do next
  sources: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
  })).default([]),
});
export type Search = z.infer<typeof SearchSchema>;

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
 * This is the primary unit Brain should reason over (not raw chat messages).
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

  deltaType: EpisodeDeltaTypeSchema,
  // Decision
  nextStep: z.string(),
  status: z.enum(['continue', 'done']),
});
export type Episode = z.infer<typeof EpisodeSchema>;

/**
 * Single research question - explores one angle of the research
 */
export const ResearchQuestionSchema = z.object({
  id: z.string(),                                  // q_xxx
  researchRound: z.number().default(1),            // Which research round this question belongs to
  title: z.string().optional(),                    // Short tab title (3–5 words). Defaults to `name`.
  name: z.string(),                                // Short label/category (2-5 words). Historically used for tabs.
  question: z.string(),                            // The research question (e.g., "Which podcast networks produce fact-heavy content?")
  goal: z.string(),                                // What we're looking to find out
  status: ResearchQuestionStatusSchema.default('pending'),
  cycles: z.number().default(0),                   // How many research→reflect loops
  maxCycles: z.number().default(10),               // Cap (default 10)
  findings: z.array(FindingSchema).default([]),    // Accumulated facts
  searches: z.array(SearchSchema).default([]),      // Search queries and their results
  reflections: z.array(CycleReflectionSchema).default([]), // What was learned each cycle
  episodes: z.array(EpisodeSchema).default([]),    // Episode memory (structured deltas)
  confidence: ResearchQuestionConfidenceSchema.default(null),
  recommendation: ResearchQuestionRecommendationSchema.default(null),
  summary: z.string().optional(),                  // Final summary when done
});

export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

/**
 * Brain decision action types
 */
export const BrainActionSchema = z.enum(['spawn', 'synthesize']);
export type BrainAction = z.infer<typeof BrainActionSchema>;

/**
 * Brain decision log entry
 */
export const BrainDecisionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: BrainActionSchema,
  questionId: z.string().optional(),
  reasoning: z.string(),
});

export type BrainDecision = z.infer<typeof BrainDecisionSchema>;

/**
 * Brain document status
 */
export const BrainStatusSchema = z.enum(['running', 'synthesizing', 'complete']);
export type BrainStatus = z.infer<typeof BrainStatusSchema>;

/**
 * Top-level research state - BrainDoc
 */
export const BrainDocSchema = z.object({
  version: z.literal(1),
  objective: z.string(),
  successCriteria: z.array(z.string()),
  researchRound: z.number().default(1),            // Current research round
  researchStrategy: z.string().optional(),         // Strategy summary for the research
  questions: z.array(ResearchQuestionSchema).default([]),
  brainLog: z.array(BrainDecisionSchema).default([]),  // History of brain decisions
  status: BrainStatusSchema.default('running'),
  finalAnswer: z.string().optional(),
});

export type BrainDoc = z.infer<typeof BrainDocSchema>;

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
 * Generate brain decision ID
 */
export function generateBrainDecisionId(): string {
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
  maxCycles: number = 10,
  researchRound: number = 1
): ResearchQuestion {
  return {
    id: generateResearchQuestionId(),
    researchRound,
    title: name,
    name,
    question,
    goal,
    status: 'pending',
    cycles: 0,
    maxCycles,
    findings: [],
    searches: [],
    reflections: [],
    episodes: [],
    confidence: null,
    recommendation: null,
  };
}

/**
 * Create a brain decision entry
 */
export function createBrainDecision(
  action: BrainAction,
  reasoning: string,
  questionId?: string
): BrainDecision {
  return {
    id: generateBrainDecisionId(),
    timestamp: new Date().toISOString(),
    action,
    questionId,
    reasoning,
  };
}

/**
 * Create a new BrainDoc
 */
export function createBrainDoc(
  objective: string,
  successCriteria: string[]
): BrainDoc {
  return {
    version: 1,
    objective,
    successCriteria,
    researchRound: 1,
    questions: [],
    brainLog: [],
    status: 'running',
  };
}
