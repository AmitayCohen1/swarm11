/**
 * Main Loop
 *
 * The control flow that runs the research system.
 * Not an agent - just code that calls agents in order.
 *
 * Flow: Intake → Generate Questions → Run Researchers → Evaluate → Synthesize
 *
 * Handles:
 * - DB persistence (brain field in chatSessions)
 * - Progress event streaming
 * - Abort/resume handling
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
  getRunningResearchQuestions,
  getCompletedResearchQuestions,
  addBrainDecision,
  setDocStatus,
  compactBrainDoc,
  incrementResearchRound,
} from '@/lib/utils/question-operations';

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
  totalCycles: number;
  creditsUsed: number;
  output: {
    confidenceLevel: 'low' | 'medium' | 'high';
    finalAnswer: string;
  };
}

// Logging helper
const log = (phase: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `[MainLoop ${timestamp}]`;
  if (data) {
    console.log(`${prefix} [${phase}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} [${phase}] ${message}`);
  }
};

/**
 * Execute the full Brain research flow
 */
export async function runMainLoop(
  config: MainLoopConfig
): Promise<MainLoopResult> {
  const {
    chatSessionId,
    researchSessionId,
    userId,
    researchBrief,
    existingBrain = '',
    onProgress,
    abortSignal
  } = config;

  // Max research rounds (rounds of questions + evaluation). Still bounded by guardrails (time/budget/user stop).
  const MAX_EVAL_ROUNDS = Number(process.env.BRAIN_MAX_EVAL_ROUNDS || 20);
  const INITIAL_QUESTIONS = 3;
  const START_TIME_MS = Date.now();
  const MAX_WALL_TIME_MS = Number(process.env.BRAIN_MAX_WALL_TIME_MS || 10 * 60 * 1000); // default 10 minutes
  const MAX_CREDITS_BUDGET = Number(process.env.BRAIN_MAX_CREDITS_BUDGET || 200); // rough tokens/1k budget

  let totalCreditsUsed = 0;
  let totalCycles = 0;
  let evalRound = 0;
  let forceSynthesize = false;

  log('INIT', '========== RESEARCH STARTED ==========');
  log('INIT', 'Config:', {
    chatSessionId,
    researchSessionId,
    objective: researchBrief.objective,
    successCriteria: researchBrief.successCriteria,
    hasExistingBrain: !!existingBrain
  });

  // ============================================================
  // HELPERS
  // ============================================================

  const checkAborted = async () => {
    if (abortSignal?.aborted) {
      throw new Error('Research aborted');
    }
    const [session] = await db
      .select({ status: chatSessions.status })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));
    if (session?.status !== 'researching') {
      throw new Error('Research stopped by user');
    }
  };

  const checkGuardrails = () => {
    const elapsed = Date.now() - START_TIME_MS;
    if (elapsed > MAX_WALL_TIME_MS) {
      forceSynthesize = true;
      return;
    }
    if (totalCreditsUsed >= MAX_CREDITS_BUDGET) {
      forceSynthesize = true;
    }
  };

  const emitProgress = async (eventOrType: string | { type: string; [key: string]: any }, data: any = {}) => {
    // Support both calling conventions:
    // emitProgress('type', { data }) - from orchestrator
    // emitProgress({ type: 'type', ...data }) - from question agent
    let event: { type: string; [key: string]: any };

    if (typeof eventOrType === 'string') {
      event = { type: eventOrType, ...data };
    } else {
      event = eventOrType;
    }

    onProgress?.(event);

    // Save to DB on every doc_updated event for real-time persistence
    if (event.type === 'doc_updated' && event.doc) {
      await saveDocToDb(event.doc);
    }
  };

  const saveDocToDb = async (doc: BrainDoc) => {
    // Compact before storage/streaming to keep brain bounded
    const compacted = compactBrainDoc(doc);
    const serializedBrain = serializeBrainDoc(compacted);
    await db
      .update(chatSessions)
      .set({ brain: serializedBrain, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    emitProgress('brain_update', { brain: serializedBrain });
    return serializedBrain;
  };

  const trackQueries = async (queries: string[], cycleNumber: number) => {
    for (const query of queries) {
      await db.insert(searchQueries).values({
        researchSessionId,
        query,
        queryNormalized: query.toLowerCase().trim(),
        purpose: '',
        answer: '',
        sources: [],
        cycleNumber
      }).onConflictDoNothing();
    }
  };

  // ============================================================
  // PHASE 1: INITIALIZE BRAIN DOC
  // ============================================================

  log('PHASE1', '══════════════════════════════════════════════════════════');
  log('PHASE1', 'INITIALIZE BRAIN DOC');

  await checkAborted();
  checkGuardrails();

  let doc: BrainDoc;
  const existingDoc = parseBrainDoc(existingBrain);

  if (existingDoc && existingDoc.version === 1) {
    log('PHASE1', 'Resuming from existing BrainDoc', {
      questions: existingDoc.questions.length,
      status: existingDoc.status
    });
    doc = existingDoc;
  } else {
    log('PHASE1', 'Creating new BrainDoc');
    doc = initializeBrainDoc(
      researchBrief.objective,
      researchBrief.successCriteria || []
    );
  }

  await saveDocToDb(doc);
  log('PHASE1', 'Doc saved to DB');

  emitProgress('brain_initialized', {
    objective: doc.objective,
    successCriteria: doc.successCriteria,
    version: 1
  });

  // ============================================================
  // PHASE 2: GENERATE INITIAL QUESTIONS
  // ============================================================

  log('PHASE2', '══════════════════════════════════════════════════════════');
  log('PHASE2', 'GENERATE QUESTIONS');

  await checkAborted();
  checkGuardrails();

  // Only generate if no questions exist
  if (doc.questions.length === 0) {
    log('PHASE2', `Generating ${INITIAL_QUESTIONS} questions...`);

    const genResult = await generateResearchQuestions({
      doc,
      count: INITIAL_QUESTIONS,
      abortSignal,
      onProgress: emitProgress
    });

    doc = genResult.doc;
    totalCreditsUsed += genResult.creditsUsed;
    await saveDocToDb(doc);

    log('PHASE2', `Generated ${genResult.questionIds.length} questions:`,
      doc.questions.map(i => ({ id: i.id, name: i.name }))
    );
  } else {
    log('PHASE2', `Using ${doc.questions.length} existing questions`);
  }

  emitProgress('doc_updated', { doc });

  // ============================================================
  // PHASE 3: RUN QUESTIONS
  // ============================================================

  log('PHASE3', '══════════════════════════════════════════════════════════');
  log('PHASE3', 'EXECUTE QUESTIONS');

  // Main evaluation loop
  while (evalRound < MAX_EVAL_ROUNDS) {
    evalRound++;
    await checkAborted();
    checkGuardrails();
    if (forceSynthesize) {
      doc = addBrainDecision(doc, 'synthesize', 'Guardrail triggered (time/budget). Synthesizing with current evidence.');
      doc = setDocStatus(doc, 'synthesizing');
      await saveDocToDb(doc);
      break;
    }

    log('PHASE3', `──────────────────────────────────────────────────────────`);
    log('PHASE3', `EVAL ROUND ${evalRound}/${MAX_EVAL_ROUNDS}`);

    // Get questions to run
    const pending = getPendingResearchQuestions(doc);
    const running = getRunningResearchQuestions(doc);
    const completed = getCompletedResearchQuestions(doc);

    log('PHASE3', 'ResearchQuestion status:', {
      pending: pending.length,
      running: running.length,
      completed: completed.length,
      pendingIds: pending.map(i => i.id)
    });

    // Run pending questions (v1: sequential)
    for (let idx = 0; idx < pending.length; idx++) {
      const question = pending[idx];
      await checkAborted();
      checkGuardrails();
      if (forceSynthesize) break;

      log('PHASE3', `┌─ QUESTION ${idx + 1}/${pending.length}: ${question.id}`);
      log('PHASE3', `│  Name: ${question.name}`);
      log('PHASE3', `│  Goal: ${question.goal}`);

      // Mark as running
      doc = startResearchQuestion(doc, question.id);
      await saveDocToDb(doc);

      emitProgress('question_started', {
        questionId: question.id,
        name: question.name,
        goal: question.goal
      });

      log('PHASE3', `│  Running question to completion...`);

      // Run to completion
      const initResult = await runResearchQuestionToCompletion({
        doc,
        questionId: question.id,
        objective: doc.objective,
        successCriteria: doc.successCriteria,
        abortSignal,
        onProgress: emitProgress
      });

      doc = initResult.doc;
      totalCreditsUsed += initResult.creditsUsed;
      totalCycles += initResult.queriesExecuted.length > 0 ? 1 : 0;
      checkGuardrails();

      // Track queries
      await trackQueries(initResult.queriesExecuted, evalRound);

      await saveDocToDb(doc);
      emitProgress('doc_updated', { doc });

      const completedInit = doc.questions.find(i => i.id === question.id);
      log('PHASE3', `└─ QUESTION COMPLETE: ${question.id}`, {
        findings: completedInit?.findings.length || 0,
        searches: initResult.queriesExecuted.length,
        confidence: completedInit?.confidence,
        recommendation: completedInit?.recommendation
      });
    }

    // ============================================================
    // EVALUATE AND DECIDE
    // ============================================================

    await checkAborted();
    checkGuardrails();
    if (forceSynthesize) {
      doc = addBrainDecision(doc, 'synthesize', 'Guardrail triggered (time/budget). Synthesizing with current evidence.');
      doc = setDocStatus(doc, 'synthesizing');
      await saveDocToDb(doc);
      break;
    }

    log('PHASE3', 'Evaluating questions...');

    const evalResult = await evaluateResearchQuestions({
      doc,
      abortSignal,
      onProgress: emitProgress
    });

    doc = evalResult.doc;
    totalCreditsUsed += evalResult.creditsUsed;
    await saveDocToDb(doc);
    checkGuardrails();

    log('PHASE3', `BRAIN DECISION: ${evalResult.nextAction.action}`, {
      reasoning: evalResult.reasoning,
      nextAction: evalResult.nextAction
    });

    // Handle the decision
    if (evalResult.nextAction.action === 'synthesize') {
      log('PHASE3', 'Decision: SYNTHESIZE - moving to Phase 4');
      break;
    }

    if (evalResult.nextAction.action === 'spawn_new') {
      const { name, question, goal } = evalResult.nextAction;
      log('PHASE3', 'Decision: SPAWN_NEW', { name, question, goal });
      // Increment research round before adding new question
      doc = incrementResearchRound(doc);
      doc = addResearchQuestion(doc, name, question, goal, 5);
      await saveDocToDb(doc);
      continue;
    }
  }

  // ============================================================
  // PHASE 4: SYNTHESIZE
  // ============================================================

  log('PHASE4', '══════════════════════════════════════════════════════════');
  log('PHASE4', 'SYNTHESIZE FINAL ANSWER');

  await checkAborted();
  // Even if guardrail triggered, we still synthesize whatever we have.
  emitProgress('synthesizing_started');

  log('PHASE4', 'Generating final synthesis...');

  const synthResult = await synthesizeFinalAnswer({
    doc,
    abortSignal,
    onProgress: emitProgress
  });

  doc = synthResult.doc;
  totalCreditsUsed += synthResult.creditsUsed;

  await saveDocToDb(doc);

  log('PHASE4', 'Synthesis complete', {
    confidence: synthResult.confidence,
    answerLength: synthResult.finalAnswer.length
  });

  // ============================================================
  // COMPLETE
  // ============================================================

  const completedInits = getCompletedResearchQuestions(doc);
  const activeFindings = doc.questions.reduce(
    (sum, i) => sum + i.findings.filter(f => f.status === 'active').length,
    0
  );

  log('DONE', '══════════════════════════════════════════════════════════');
  log('DONE', '========== RESEARCH COMPLETE ==========');
  log('DONE', 'Final stats:', {
    totalResearchQuestions: doc.questions.length,
    completedResearchQuestions: completedInits.length,
    totalFindings: activeFindings,
    totalCycles,
    totalCreditsUsed,
    confidence: synthResult.confidence
  });

  emitProgress('research_complete', {
    totalResearchQuestions: doc.questions.length,
    completedResearchQuestions: completedInits.length,
    totalFindings: activeFindings,
    confidence: synthResult.confidence
  });

  return {
    completed: true,
    totalResearchQuestions: doc.questions.length,
    totalCycles,
    creditsUsed: totalCreditsUsed,
    output: {
      confidenceLevel: synthResult.confidence,
      finalAnswer: synthResult.finalAnswer
    }
  };
}
