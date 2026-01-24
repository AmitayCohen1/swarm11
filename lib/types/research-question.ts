/**
 * Research System Types
 *
 * MEMORY MODEL (simplified):
 *
 * Each ResearchQuestion has one `memory` array - a simple message list:
 *
 *   [
 *     { type: 'search', query: "podcast networks" },
 *     { type: 'result', answer: "Found Gimlet, Wondery...", sources: [...] },
 *     { type: 'reflect', thought: "Interesting, let me dig into Gimlet..." },
 *     { type: 'search', query: "Gimlet Media contact" },
 *     ...
 *   ]
 *
 * That's it. No separate searches/episodes/reflections/findings arrays.
 * Brain reads this conversation to understand what happened.
 * Brain decisions are tracked separately in `brainLog`.
 */

import { z } from 'zod';

// ============================================================
// Source type (for search results)
// ============================================================

export const SourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

// ============================================================
// Memory Entry - the core unit of research memory
// ============================================================

/**
 * Memory is a simple message list. Three types:
 * - search: "I searched for X"
 * - result: "I found Y (with sources)"
 * - reflect: "I think Z, next I'll do W"
 */
export const MemoryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('search'),
    query: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    answer: z.string(),
    sources: z.array(SourceSchema).default([]),
  }),
  z.object({
    type: z.literal('reflect'),
    thought: z.string(),
    delta: z.enum(['progress', 'no_change', 'dead_end']).optional(),
  }),
]);
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ============================================================
// ResearchQuestion status & confidence
// ============================================================

export const ResearchQuestionStatusSchema = z.enum(['pending', 'running', 'done']);
export type ResearchQuestionStatus = z.infer<typeof ResearchQuestionStatusSchema>;

export const ResearchQuestionConfidenceSchema = z.enum(['low', 'medium', 'high']).nullable();
export type ResearchQuestionConfidence = z.infer<typeof ResearchQuestionConfidenceSchema>;

export const ResearchQuestionRecommendationSchema = z.enum(['promising', 'dead_end', 'needs_more']).nullable();
export type ResearchQuestionRecommendation = z.infer<typeof ResearchQuestionRecommendationSchema>;

// ============================================================
// Question Document - structured output when question completes
// ============================================================

export const QuestionDocumentSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  contribution: z.string(),  // What this source told us
});
export type QuestionDocumentSource = z.infer<typeof QuestionDocumentSourceSchema>;

export const QuestionDocumentSchema = z.object({
  answer: z.string(),                              // 2-3 paragraph comprehensive answer
  keyFindings: z.array(z.string()),                // Bullet points of main facts
  sources: z.array(QuestionDocumentSourceSchema),  // Sources with their contributions
  limitations: z.string().optional(),              // What we couldn't find
});
export type QuestionDocument = z.infer<typeof QuestionDocumentSchema>;

// ============================================================
// ResearchQuestion - one research angle
// ============================================================

export const ResearchQuestionSchema = z.object({
  id: z.string(),                                  // q_xxx
  researchRound: z.number().default(1),            // Which research round this belongs to
  name: z.string(),                                // Short label (2-5 words) for tabs
  question: z.string(),                            // The main research question (shown prominently)
  description: z.string().optional(),              // Why this matters / context
  goal: z.string(),                                // What success looks like
  status: ResearchQuestionStatusSchema.default('pending'),
  cycles: z.number().default(0),                   // How many search→reflect loops
  maxCycles: z.number().default(10),               // Cap (default 10)
  memory: z.array(MemoryEntrySchema).default([]),  // Simple message list
  confidence: ResearchQuestionConfidenceSchema.default(null),
  recommendation: ResearchQuestionRecommendationSchema.default(null),
  summary: z.string().optional(),                  // Legacy: short summary
  document: QuestionDocumentSchema.optional(),     // Structured document when done
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

export function generateResearchQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function generateBrainDecisionId(): string {
  return `dec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ============================================================
// Factory Functions
// ============================================================

export function createResearchQuestion(
  name: string,
  question: string,
  goal: string,
  maxCycles: number = 10,
  researchRound: number = 1,
  description?: string
): ResearchQuestion {
  return {
    id: generateResearchQuestionId(),
    researchRound,
    name,
    question,
    description,
    goal,
    status: 'pending',
    cycles: 0,
    maxCycles,
    memory: [],
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
