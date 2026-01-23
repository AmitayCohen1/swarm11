/**
 * Cortex Orchestrator
 *
 * Manages the complete execution flow of the Cortex architecture:
 * Intake → Generate ResearchQuestions → Run ResearchQuestions → Evaluate → Synthesize
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
  adversarialReview,
} from './cortex-agent';
import { runResearchQuestionToCompletion } from './question-agent';
import type { CortexDoc } from '@/lib/types/research-question';
import {
  initializeCortexDoc,
  serializeCortexDoc,
  parseCortexDoc,
  addResearchQuestion,
  startResearchQuestion,
  getPendingResearchQuestions,
  getRunningResearchQuestions,
  getCompletedResearchQuestions,
  addCortexDecision,
  setDocStatus,
} from '@/lib/utils/question-operations';

interface CortexOrchestratorConfig {
  chatSessionId: string;
  researchSessionId: string;
  userId: string;
  researchBrief: ResearchBrief;
  existingBrain?: string;
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

interface CortexOrchestratorResult {
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
  const prefix = `[Cortex ${timestamp}]`;
  if (data) {
    console.log(`${prefix} [${phase}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} [${phase}] ${message}`);
  }
};

/**
 * Execute the full Cortex research flow
 */
export async function executeCortexResearch(
  config: CortexOrchestratorConfig
): Promise<CortexOrchestratorResult> {
  const {
    chatSessionId,
    researchSessionId,
    userId,
    researchBrief,
    existingBrain = '',
    onProgress,
    abortSignal
  } = config;

  const MAX_EVAL_ROUNDS = 5;  // Max evaluation cycles
  const INITIAL_INITIATIVES = 3;

  let totalCreditsUsed = 0;
  let totalCycles = 0;
  let evalRound = 0;

  log('INIT', '========== CORTEX RESEARCH STARTED ==========');
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

  const saveDocToDb = async (doc: CortexDoc) => {
    const serializedBrain = serializeCortexDoc(doc);
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
  // PHASE 1: INITIALIZE CORTEX DOC
  // ============================================================

  log('PHASE1', '══════════════════════════════════════════════════════════');
  log('PHASE1', 'INITIALIZE CORTEX DOC');

  await checkAborted();

  let doc: CortexDoc;
  const existingDoc = parseCortexDoc(existingBrain);

  if (existingDoc && existingDoc.version === 1) {
    log('PHASE1', 'Resuming from existing CortexDoc', {
      questions: existingDoc.questions.length,
      status: existingDoc.status
    });
    doc = existingDoc;
  } else {
    log('PHASE1', 'Creating new CortexDoc');
    doc = initializeCortexDoc(
      researchBrief.objective,
      researchBrief.successCriteria || []
    );
  }

  await saveDocToDb(doc);
  log('PHASE1', 'Doc saved to DB');

  emitProgress('cortex_initialized', {
    objective: doc.objective,
    successCriteria: doc.successCriteria,
    version: 1
  });

  // ============================================================
  // PHASE 2: GENERATE INITIAL INITIATIVES
  // ============================================================

  log('PHASE2', '══════════════════════════════════════════════════════════');
  log('PHASE2', 'GENERATE INITIATIVES');

  await checkAborted();

  // Only generate if no questions exist
  if (doc.questions.length === 0) {
    log('PHASE2', `Generating ${INITIAL_INITIATIVES} questions...`);

    const genResult = await generateResearchQuestions({
      doc,
      count: INITIAL_INITIATIVES,
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
  // PHASE 3: RUN INITIATIVES
  // ============================================================

  log('PHASE3', '══════════════════════════════════════════════════════════');
  log('PHASE3', 'EXECUTE INITIATIVES');

  // Main evaluation loop
  while (evalRound < MAX_EVAL_ROUNDS) {
    evalRound++;
    await checkAborted();

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

      log('PHASE3', `┌─ INITIATIVE ${idx + 1}/${pending.length}: ${question.id}`);
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

      // Track queries
      await trackQueries(initResult.queriesExecuted, evalRound);

      await saveDocToDb(doc);
      emitProgress('doc_updated', { doc });

      const completedInit = doc.questions.find(i => i.id === question.id);
      log('PHASE3', `└─ INITIATIVE COMPLETE: ${question.id}`, {
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

    log('PHASE3', 'Evaluating questions...');

    const evalResult = await evaluateResearchQuestions({
      doc,
      abortSignal,
      onProgress: emitProgress
    });

    doc = evalResult.doc;
    totalCreditsUsed += evalResult.creditsUsed;
    await saveDocToDb(doc);

    log('PHASE3', `CORTEX DECISION: ${evalResult.nextAction.action}`, {
      reasoning: evalResult.reasoning,
      nextAction: evalResult.nextAction
    });

    // Handle the decision
    if (evalResult.nextAction.action === 'synthesize') {
      log('PHASE3', 'Decision: SYNTHESIZE - moving to Phase 4');
      break;
    }

    if (evalResult.nextAction.action === 'continue') {
      // Continue running pending questions (will be picked up next loop)
      if (getPendingResearchQuestions(doc).length === 0) {
        log('PHASE3', 'No pending questions, forcing synthesis');
        break;
      }
      log('PHASE3', 'Decision: CONTINUE - running more questions');
      continue;
    }

    if (evalResult.nextAction.action === 'drill_down') {
      const { questionId, name, description, goal } = evalResult.nextAction;
      log('PHASE3', `Decision: DRILL_DOWN from ${questionId}`, { name, description, goal });
      doc = addResearchQuestion(doc, name, description, goal, 5);
      await saveDocToDb(doc);
      continue;
    }

    if (evalResult.nextAction.action === 'spawn_new') {
      const { name, description, goal } = evalResult.nextAction;
      log('PHASE3', 'Decision: SPAWN_NEW', { name, description, goal });
      doc = addResearchQuestion(doc, name, description, goal, 5);
      await saveDocToDb(doc);
      continue;
    }
  }

  // ============================================================
  // PHASE 4: ADVERSARIAL REVIEW (optional)
  // ============================================================

  log('PHASE4', '══════════════════════════════════════════════════════════');
  log('PHASE4', 'ADVERSARIAL REVIEW');

  await checkAborted();
  emitProgress('review_started');

  log('PHASE4', 'Running adversarial review...');

  const reviewResult = await adversarialReview({
    doc,
    abortSignal,
    onProgress: emitProgress
  });

  totalCreditsUsed += reviewResult.creditsUsed;

  emitProgress('review_completed', {
    verdict: reviewResult.verdict,
    critique: reviewResult.critique,
    missing: reviewResult.missing
  });

  log('PHASE4', `Review verdict: ${reviewResult.verdict}`, {
    critique: reviewResult.critique,
    missing: reviewResult.missing
  });

  // If review fails and we haven't hit max rounds, could add more questions
  // For v1, we proceed to synthesis regardless
  if (reviewResult.verdict === 'fail') {
    log('PHASE4', 'Review FAILED - proceeding to synthesis anyway');
    emitProgress('review_rejected', {
      critique: reviewResult.critique,
      missing: reviewResult.missing
    });
  } else {
    log('PHASE4', 'Review PASSED');
  }

  // ============================================================
  // PHASE 5: SYNTHESIZE
  // ============================================================

  log('PHASE5', '══════════════════════════════════════════════════════════');
  log('PHASE5', 'SYNTHESIZE FINAL ANSWER');

  await checkAborted();
  emitProgress('synthesizing_started');

  log('PHASE5', 'Generating final synthesis...');

  const synthResult = await synthesizeFinalAnswer({
    doc,
    abortSignal,
    onProgress: emitProgress
  });

  doc = synthResult.doc;
  totalCreditsUsed += synthResult.creditsUsed;

  await saveDocToDb(doc);

  log('PHASE5', 'Synthesis complete', {
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
  log('DONE', '========== CORTEX RESEARCH COMPLETE ==========');
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
