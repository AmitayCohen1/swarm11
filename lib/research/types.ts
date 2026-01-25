/**
 * Research System Types - Simplified
 */

// ============================================================
// Cortex Memory - Brain's orchestration log
// ============================================================

export type CortexEvent =
  | { type: 'kickoff'; reasoning: string; spawnedIds: string[] }
  | { type: 'question_done'; questionId: string }
  | { type: 'evaluation'; reasoning: string; decision: 'spawn' | 'synthesize'; spawnedIds?: string[] };

export interface CortexMemory {
  objective: string;
  history: CortexEvent[];
  finalAnswer?: string;
}

// ============================================================
// Research Question Memory - Researcher's workspace
// ============================================================

export type ResearchQuestionEvent =
  | { type: 'search'; query: string; answer: string }
  | { type: 'reflect'; thought: string };

export interface ResearchQuestionMemory {
  id: string;
  question: string;
  description: string;
  goal: string;
  status: 'pending' | 'running' | 'done';
  history: ResearchQuestionEvent[];
  answer?: string;
  confidence?: 'low' | 'medium' | 'high';
}

// ============================================================
// Storage blob (stored in chat_sessions.brain)
// ============================================================

export interface ResearchState {
  cortex: CortexMemory;
  questions: Record<string, ResearchQuestionMemory>;
}

// ============================================================
// Helpers
// ============================================================

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function createCortex(objective: string): CortexMemory {
  return { objective, history: [] };
}

export function createQuestion(
  question: string,
  description: string,
  goal: string
): ResearchQuestionMemory {
  return {
    id: `q_${generateId()}`,
    question,
    description,
    goal,
    status: 'pending',
    history: [],
  };
}
