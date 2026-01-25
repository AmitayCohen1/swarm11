/**
 * Main Loop - Research Orchestration
 *
 * Flow:
 * 1. Initialize doc
 * 2. Generate first batch of questions
 * 3. Loop: run questions → brain evaluates → continue or synthesize
 * 4. Synthesize final answer
 */

import { db } from '@/lib/db';
import { chatSessions, searchQueries } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ResearchBrief } from './intake-agent';
import {
  generateResearchQuestions,
  evaluateResearchQuestions,
  synthesizeFinalAnswer,
} from './brain-agent';
import { runResearchQuestionToCompletion } from './researcher-agent';
import type { BrainDoc } from '@/lib/types/research-question';
import {
  initializeBrainDoc,
  serializeBrainDoc,
  parseBrainDoc,
  addResearchQuestion,
  startResearchQuestion,
  getPendingResearchQuestions,
  getCompletedResearchQuestions,
  addBrainDecision,
  setDocStatus,
  compactBrainDoc,
  incrementResearchRound,
} from '@/lib/utils/question-operations';

// ============================================================
// Types
// ============================================================

interface MainLoopConfig {
  chatSessionId: string;
  researchSessionId: string;
  userId: string;
  researchBrief: ResearchBrief;
  existingBrain?: string;
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

interface MainLoopResult {
  completed: boolean;
  totalResearchQuestions: number;
  creditsUsed: number;
  output: {
    confidenceLevel: 'low' | 'medium' | 'high';
    finalAnswer: string;
  };
}

// ============================================================
// Config
// ============================================================

const CONFIG = {
  maxRounds: Number(process.env.BRAIN_MAX_EVAL_ROUNDS || 50),
  maxTimeMs: Number(process.env.BRAIN_MAX_WALL_TIME_MS || 15 * 60 * 1000),
  maxCredits: Number(process.env.BRAIN_MAX_CREDITS_BUDGET || 1000),
  initialQuestions: 3,
};

// ============================================================
// Main Loop
// ============================================================

export async function runMainLoop(config: MainLoopConfig): Promise<MainLoopResult> {
  const { chatSessionId, researchSessionId, researchBrief, existingBrain, onProgress, abortSignal } = config;

  const startTime = Date.now();
  let creditsUsed = 0;
  let round = 0;

  // --- Helpers ---

  const save = async (doc: BrainDoc) => {
    const compacted = compactBrainDoc(doc);
    const serialized = serializeBrainDoc(compacted);
    await db.update(chatSessions).set({ brain: serialized, updatedAt: new Date() }).where(eq(chatSessions.id, chatSessionId));
    onProgress?.({ type: 'brain_update', brain: serialized });
  };

  const emit = (type: string, data: any = {}) => {
    onProgress?.({ type, ...data });
  };

  const checkAbort = async () => {
    if (abortSignal?.aborted) throw new Error('Research aborted');
    const [session] = await db.select({ status: chatSessions.status }).from(chatSessions).where(eq(chatSessions.id, chatSessionId));
    if (session?.status !== 'researching') throw new Error('Research stopped');
  };

  const shouldStop = () => {
    const elapsed = Date.now() - startTime;
    return elapsed > CONFIG.maxTimeMs || creditsUsed >= CONFIG.maxCredits || round >= CONFIG.maxRounds;
  };

  const trackQueries = async (queries: string[]) => {
    for (const query of queries) {
      await db.insert(searchQueries).values({
        researchSessionId,
        query,
        queryNormalized: query.toLowerCase().trim(),
        purpose: '',
        answer: '',
        sources: [],
        cycleNumber: round
      }).onConflictDoNothing();
    }
  };

  // --- 1. Initialize ---

  let doc: BrainDoc;
  const existing = parseBrainDoc(existingBrain || '');

  if (existing?.version === 1) {
    doc = existing;
  } else {
    doc = initializeBrainDoc(researchBrief.objective, researchBrief.successCriteria || []);
  }

  await save(doc);
  emit('brain_initialized', { objective: doc.objective, successCriteria: doc.successCriteria });

  // --- 2. Generate first questions ---

  if (doc.questions.length === 0) {
    const result = await generateResearchQuestions({
      doc,
      count: CONFIG.initialQuestions,
      abortSignal,
      onProgress
    });
    doc = result.doc;
    creditsUsed += result.creditsUsed;
    await save(doc);
  }

  emit('doc_updated', { doc });

  // --- 3. Research loop ---

  while (!shouldStop()) {
    round++;
    await checkAbort();

    // Run all pending questions
    const pending = getPendingResearchQuestions(doc);

    for (const question of pending) {
      await checkAbort();
      if (shouldStop()) break;

      doc = startResearchQuestion(doc, question.id);
      await save(doc);
      emit('question_started', { questionId: question.id, name: question.name, goal: question.goal });

      const result = await runResearchQuestionToCompletion({
        doc,
        questionId: question.id,
        objective: doc.objective,
        successCriteria: doc.successCriteria,
        abortSignal,
        onProgress
      });

      doc = result.doc;
      creditsUsed += result.creditsUsed;
      await trackQueries(result.queriesExecuted);
      await save(doc);
      emit('doc_updated', { doc });
    }

    // Brain evaluates
    if (shouldStop()) {
      doc = addBrainDecision(doc, 'synthesize', 'Guardrail triggered. Synthesizing with current evidence.');
      doc = setDocStatus(doc, 'synthesizing');
      await save(doc);
      break;
    }

    const evalResult = await evaluateResearchQuestions({ doc, abortSignal, onProgress });
    doc = evalResult.doc;
    creditsUsed += evalResult.creditsUsed;
    await save(doc);

    // Decide: synthesize or continue
    if (evalResult.nextAction.action === 'synthesize') {
      break;
    }

    // Spawn new questions
    if (evalResult.nextAction.action === 'spawn_new') {
      doc = incrementResearchRound(doc);
      for (const q of evalResult.nextAction.questions) {
        doc = addResearchQuestion(doc, q.name, q.question, q.goal, 30, q.description);
      }
      await save(doc);
    }
  }

  // --- 4. Synthesize ---

  emit('synthesizing_started');

  const synthResult = await synthesizeFinalAnswer({ doc, abortSignal, onProgress });
  doc = synthResult.doc;
  creditsUsed += synthResult.creditsUsed;
  await save(doc);

  // --- Done ---

  const completed = getCompletedResearchQuestions(doc);
  emit('research_complete', {
    totalResearchQuestions: doc.questions.length,
    completedResearchQuestions: completed.length,
    confidence: synthResult.confidence
  });

  return {
    completed: true,
    totalResearchQuestions: doc.questions.length,
    creditsUsed,
    output: {
      confidenceLevel: synthResult.confidence,
      finalAnswer: synthResult.finalAnswer
    }
  };
}
