/**
 * Research Run - Main orchestration loop
 */

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ResearchBrief } from '@/lib/agents/intake-agent';
import type { ResearchState, CortexMemory, ResearchQuestionMemory, ResearchQuestionEvent } from './types';
import { createCortex } from './types';
import { kickoff, evaluate, synthesize } from './brain';
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

  // Build brain log from cortex history
  const brainLog = state.cortex.history.map((event, idx) => {
    if (event.type === 'kickoff') {
      return {
        id: `dec_${idx}`,
        timestamp: new Date().toISOString(),
        action: 'spawn' as const,
        reasoning: event.reasoning
      };
    } else if (event.type === 'evaluation') {
      return {
        id: `dec_${idx}`,
        timestamp: new Date().toISOString(),
        action: event.decision,
        reasoning: event.reasoning
      };
    }
    return null;
  }).filter(Boolean);

  return {
    version: 1,
    objective: state.cortex.objective,
    successCriteria: [],
    researchRound: round,
    questions,
    brainLog,
    status: state.cortex.finalAnswer ? 'complete' : 'running',
    finalAnswer: state.cortex.finalAnswer
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
  const cortex: CortexMemory = createCortex(researchBrief.objective);
  const questions: Record<string, ResearchQuestionMemory> = {};
  const state: ResearchState = { cortex, questions };

  await save(state);
  onProgress?.({ type: 'research_initialized', objective: cortex.objective });

  // Kickoff - generate initial questions
  log('Starting kickoff...');
  const kickoffResult = await kickoff(cortex);
  log('Kickoff complete', { questionCount: kickoffResult.questions.length });

  cortex.history.push({
    type: 'kickoff',
    reasoning: kickoffResult.reasoning,
    spawnedIds: kickoffResult.questions.map(q => q.id),
  });

  for (const q of kickoffResult.questions) {
    questions[q.id] = q;
  }

  await save(state);
  onProgress?.({ type: 'brain_kickoff', reasoning: kickoffResult.reasoning, questionCount: kickoffResult.questions.length });

  // Main loop
  while (round < CONFIG.maxRounds && !shouldStop()) {
    round++;

    // Run all pending questions
    const pending = Object.values(questions).filter(q => q.status === 'pending');

    for (const pendingQ of pending) {
      if (shouldStop()) break;

      // Mark as running
      questions[pendingQ.id] = { ...pendingQ, status: 'running' };
      await save(state);

      const result = await runQuestion(pendingQ, cortex.objective, async (update) => {
        onProgress?.(update);
        // Update question state from researcher progress and save to DB
        if (update.question) {
          questions[pendingQ.id] = update.question;
          await save(state);
        }
      });

      questions[pendingQ.id] = result.question;
      cortex.history.push({ type: 'question_done', questionId: pendingQ.id });
      await save(state);
    }

    // Check if we should stop
    if (shouldStop()) break;

    // Evaluate
    log('Evaluating...');
    const evalResult = await evaluate(cortex, questions);
    log('Evaluation complete', { decision: evalResult.decision });

    cortex.history.push({
      type: 'evaluation',
      reasoning: evalResult.reasoning,
      decision: evalResult.decision,
      spawnedIds: evalResult.questions?.map(q => q.id),
    });

    onProgress?.({ type: 'brain_evaluation', reasoning: evalResult.reasoning, decision: evalResult.decision });

    if (evalResult.decision === 'synthesize') {
      break;
    }

    // Spawn new questions
    if (evalResult.questions) {
      for (const q of evalResult.questions) {
        questions[q.id] = q;
      }
    }

    await save(state);
  }

  // Synthesize final answer
  log('Synthesizing...');
  onProgress?.({ type: 'synthesizing' });
  const finalAnswer = await synthesize(cortex, questions);
  cortex.finalAnswer = finalAnswer;
  log('Synthesis complete', { answerLength: finalAnswer.length });

  await save(state);

  onProgress?.({
    type: 'research_complete',
    totalQuestions: Object.keys(questions).length,
    answerLength: finalAnswer.length,
  });

  return {
    completed: true,
    totalQuestions: Object.keys(questions).length,
    output: { finalAnswer },
  };
}
