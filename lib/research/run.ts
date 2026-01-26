/**
 * Research Run - Main orchestration loop
 */

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ResearchBrief } from '@/lib/agents/intake-agent';
import type { ResearchState, BrainMemory, ResearchQuestionMemory, ResearchQuestionEvent } from './types';
import { createBrainMemory } from './types';
import { evaluate as brainEvaluate, finish as brainFinish } from './brain';
import { runQuestion } from './researcher';

// ============================================================
// Config
// ============================================================

const CONFIG = {
  maxRounds: 10,
  maxTimeMs: 15 * 60 * 1000, // 15 minutes
};

// ============================================================
// Types
// ============================================================

export interface RunConfig {
  chatSessionId: string;
  researchBrief: ResearchBrief;
  onProgress?: (update: any) => void;
}

export interface RunResult {
  completed: boolean;
  totalQuestions: number;
  output: {
    finalAnswer: string;
  };
}

// ============================================================
// Transform state to frontend-compatible format
// ============================================================

function toFrontendFormat(state: ResearchState, round: number): any {
  // Transform our internal format to what the frontend expects
  const questions = Object.values(state.questions).map(q => {
    // Convert our combined search events to separate search/result pairs
    const memory: any[] = [];
    for (const event of q.history) {
      if (event.type === 'search') {
        memory.push({ type: 'search', query: event.query });
        memory.push({ type: 'result', answer: event.answer, sources: [] });
      } else if (event.type === 'reflect') {
        memory.push({ type: 'reflect', thought: event.thought });
      }
    }

    return {
      id: q.id,
      researchRound: round,
      name: q.question.substring(0, 30) + (q.question.length > 30 ? '...' : ''),
      question: q.question,
      description: q.description,
      goal: q.goal,
      status: q.status,
      cycles: memory.filter(m => m.type === 'search').length,
      maxCycles: 30,
      memory,
      confidence: q.status === 'done' ? 'medium' : null,
      recommendation: null,
      summary: q.answer?.substring(0, 200),
      document: q.answer ? {
        answer: q.answer,
        keyFindings: [],
        sources: [],
        limitations: ''
      } : undefined
    };
  });

  // Build brain log from brain history
  const brainLog = state.brain.history.map((event, idx) => {
    if (event.type === 'evaluate') {
      return {
        id: `dec_${idx}`,
        timestamp: new Date().toISOString(),
        action: event.decision === 'continue' ? 'spawn' : 'synthesize', // map to frontend format
        reasoning: event.reasoning
      };
    }
    return null;
  }).filter(Boolean);

  return {
    version: 1,
    objective: state.brain.objective,
    successCriteria: state.brain.successCriteria || [],
    researchRound: round,
    questions,
    brainLog,
    status: state.brain.finalAnswer ? 'complete' : 'running',
    finalAnswer: state.brain.finalAnswer
  };
}

// ============================================================
// Main Loop
// ============================================================

export async function runResearch(config: RunConfig): Promise<RunResult> {
  const { chatSessionId, researchBrief, onProgress } = config;
  const startTime = Date.now();
  let round = 0;

  const log = (msg: string, data?: any) => {
    console.log(`[Research] ${msg}`, data ? JSON.stringify(data).substring(0, 200) : '');
  };

  // Helpers
  const save = async (state: ResearchState) => {
    const frontendDoc = toFrontendFormat(state, round);
    const serialized = JSON.stringify(frontendDoc);
    await db.update(chatSessions)
      .set({ brain: serialized, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    onProgress?.({ type: 'brain_update', brain: serialized });
  };

  const shouldStop = () => Date.now() - startTime > CONFIG.maxTimeMs;

  // Initialize state
  log('Initializing research', { objective: researchBrief.objective });
  const brain: BrainMemory = createBrainMemory(researchBrief.objective, researchBrief.successCriteria);
  const questions: Record<string, ResearchQuestionMemory> = {};
  const state: ResearchState = { brain, questions };

  await save(state);
  onProgress?.({ type: 'research_initialized', objective: brain.objective });

  // Main loop - brain evaluates, researchers execute, repeat
  while (round < CONFIG.maxRounds && !shouldStop()) {
    round++;

    // Brain evaluates - decides continue or done
    const completed = Object.values(questions).filter(q => q.status === 'done');
    log('Brain evaluating...', { completedQuestions: completed.length });
    const evalResult = await brainEvaluate(brain.objective, completed, brain.successCriteria);
    log('Brain decided', { decision: evalResult.decision, newQuestions: evalResult.questions?.length || 0 });

    brain.history.push({
      type: 'evaluate',
      reasoning: evalResult.reasoning,
      decision: evalResult.decision,
      spawnedIds: evalResult.questions?.map(q => q.id),
    });

    onProgress?.({ type: 'brain_evaluate', reasoning: evalResult.reasoning, decision: evalResult.decision });

    // If brain says done, we're ready to finish
    if (evalResult.decision === 'done') {
      await save(state);
      break;
    }

    // Add new questions from brain
    if (evalResult.questions) {
      for (const q of evalResult.questions) {
        questions[q.id] = q;
      }
    }

    await save(state);

    // Run all pending questions
    const pending = Object.values(questions).filter(q => q.status === 'pending');

    for (const pendingQ of pending) {
      if (shouldStop()) break;

      // Mark as running
      questions[pendingQ.id] = { ...pendingQ, status: 'running' };
      await save(state);

      const result = await runQuestion(pendingQ, brain.objective, async (update) => {
        onProgress?.(update);
        // Update question state from researcher progress and save to DB
        // Only update if it's a proper question object (has history array)
        if (update.question && typeof update.question === 'object' && Array.isArray(update.question.history)) {
          questions[pendingQ.id] = update.question;
          await save(state);
        }
      });

      questions[pendingQ.id] = result.question;
      brain.history.push({ type: 'question_done', questionId: pendingQ.id });
      await save(state);
    }

    // Check if we should stop
    if (shouldStop()) break;
  }

  // Brain finishes - produces final answer
  const completedFinal = Object.values(questions).filter(q => q.status === 'done');
  log('Brain finishing...');
  onProgress?.({ type: 'brain_finishing' });
  const finishResult = await brainFinish(brain.objective, completedFinal, brain.successCriteria);
  brain.finalAnswer = finishResult.answer;
  log('Brain finished', { answerLength: finishResult.answer.length });

  await save(state);

  onProgress?.({
    type: 'research_complete',
    totalQuestions: Object.keys(questions).length,
    answerLength: finishResult.answer.length,
  });

  return {
    completed: true,
    totalQuestions: Object.keys(questions).length,
    output: { finalAnswer: finishResult.answer },
  };
}
