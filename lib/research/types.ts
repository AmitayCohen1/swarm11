/**
 * Research System Types - Simplified
 */

// ============================================================
// Brain Memory - Brain's orchestration log
// ============================================================

export type BrainEvent =
  | { type: 'evaluate'; reasoning: string; decision: 'continue' | 'done'; spawnedIds?: string[] }
  | { type: 'question_done'; questionId: string };

export interface BrainMemory {
  objective: string;
  successCriteria?: string[];
  reason?: string;
  history: BrainEvent[];
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
  round: number;
  status: 'pending' | 'running' | 'done';
  history: ResearchQuestionEvent[];
  answer?: string;
  confidence?: 'low' | 'medium' | 'high';
}

// ============================================================
// Storage blob (stored in chat_sessions.brain)
// ============================================================

export interface ResearchState {
  brain: BrainMemory;
  questions: Record<string, ResearchQuestionMemory>;
}

// ============================================================
// Helpers
// ============================================================

export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function createBrainMemory(objective: string, successCriteria?: string[]): BrainMemory {
  return { objective, successCriteria, history: [] };
}

export function createQuestion(
  question: string,
  description: string,
  goal: string,
  round: number
): ResearchQuestionMemory {
  return {
    id: `q_${generateId()}`,
    question,
    description,
    goal,
    round,
    status: 'pending',
    history: [],
  };
}
