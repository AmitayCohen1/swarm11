/**
 * Research Executor Agent - Document-Centric Architecture (v4)
 *
 * Orchestrates the research loop:
 * 1. PLAN: Read doc.strategy.nextActions[0]
 * 2. SEARCH: Search Agent executes searches, returns raw findings
 * 3. REFLECT: Reflection Agent analyzes findings, produces section updates
 * 4. UPDATE: Apply updates to document (deterministic)
 * 5. CHECK: Is doneWhen satisfied? If no, loop back to step 1
 *
 * The Research Document is the single source of truth.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/lib/db';
import { chatSessions, searchQueries } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ResearchBrief } from './orchestrator-chat-agent';
import { executeSearch, createSearchTask } from './search-agent';
import { analyzeAndReflect } from './reflection-agent';
import {
  createResearchDoc,
  formatDocForAgent,
  serializeDoc,
  parseBrainToDoc,
  applyReflectionOutput,
  addQueriesToDoc,
  getDocSummary,
  getCurrentStrategy,
  appendStrategy,
} from '@/lib/utils/doc-operations';
import type { ResearchDoc } from '@/lib/types/research-doc';

interface ResearchExecutorConfig {
  chatSessionId: string;
  researchSessionId: string;
  userId: string;
  researchBrief: ResearchBrief;
  conversationHistory?: any[];
  existingBrain?: string;
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

/**
 * Research Executor - Document-Centric Loop
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    researchSessionId,
    userId,
    researchBrief,
    conversationHistory = [],
    existingBrain = '',
    onProgress,
    abortSignal
  } = config;

  const MAX_ITERATIONS = 50;

  let totalCreditsUsed = 0;
  let iterationCount = 0;
  let searchCount = 0;

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

  const emitProgress = (type: string, data: any = {}) => {
    onProgress?.({ type, ...data });
  };

  const saveDocToDb = async (doc: ResearchDoc) => {
    const serializedBrain = serializeDoc(doc);
    await db
      .update(chatSessions)
      .set({ brain: serializedBrain, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    emitProgress('brain_update', { brain: serializedBrain });
    return serializedBrain;
  };

  // ============================================================
  // PHASE 1: INITIALIZE DOCUMENT
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 1: INITIALIZE DOCUMENT');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();

  // Try to parse existing brain or create new document
  let doc: ResearchDoc;
  const existingDoc = parseBrainToDoc(existingBrain);

  if (existingDoc) {
    console.log('[Research] Continuing with existing document (v4)');
    doc = existingDoc;
  } else {
    console.log('[Research] Creating new research document');
    doc = createResearchDoc(
      researchBrief.objective,
      researchBrief.doneWhen,
      researchBrief.initialStrategy
    );
  }

  await saveDocToDb(doc);

  emitProgress('research_initialized', {
    objective: doc.objective,
    doneWhen: doc.doneWhen,
    version: 4
  });

  emitProgress('doc_updated', {
    doc: {
      objective: doc.objective,
      doneWhen: doc.doneWhen,
      sections: doc.sections,
      strategyLog: doc.strategyLog
    }
  });

  // ============================================================
  // PHASE 2: SEARCH → REFLECT → UPDATE LOOP
  // ============================================================

  let researchDone = false;

  while (!researchDone && iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    await checkAborted();

    console.log('[Research] ───────────────────────────────────────────────────');
    console.log(`[Research] ITERATION ${iterationCount}`);

    // ──────────────────────────────────────────────────────────
    // STEP 1: PLAN - Get next action from strategy
    // ──────────────────────────────────────────────────────────

    const currentStrategy = getCurrentStrategy(doc);
    const nextAction = currentStrategy?.nextActions[0] || 'Continue exploring the research objective';

    console.log(`[Research] Next action: ${nextAction}`);

    emitProgress('iteration_started', {
      iteration: iterationCount,
      action: nextAction,
      currentStrategy
    });

    // ──────────────────────────────────────────────────────────
    // STEP 2: SEARCH - Execute Search Agent
    // ──────────────────────────────────────────────────────────

    console.log(`[Research] STEP 2: SEARCH`);

    const searchTask = createSearchTask(
      nextAction,
      getDocSummary(doc),
      doc.objective,
      doc.doneWhen,
      doc.queriesRun
    );

    const searchResult = await executeSearch({
      task: searchTask,
      abortSignal,
      onProgress: (update) => {
        emitProgress(update.type, update);
      }
    });

    totalCreditsUsed += searchResult.creditsUsed;
    searchCount += searchResult.queriesExecuted.length;

    // Add queries to doc for deduplication
    doc = addQueriesToDoc(doc, searchResult.queriesExecuted);

    // Track queries in DB
    for (const query of searchResult.queriesExecuted) {
      const queryData = searchResult.findings.queries.find(q => q.query === query);
      await db.insert(searchQueries).values({
        researchSessionId,
        query,
        queryNormalized: query.toLowerCase().trim(),
        purpose: queryData?.purpose || '',
        answer: queryData?.answer || '',
        sources: queryData?.sources || [],
        cycleNumber: iterationCount
      });
    }

    await saveDocToDb(doc);

    console.log(`[Research] Search complete: ${searchResult.queriesExecuted.length} queries`);

    // ──────────────────────────────────────────────────────────
    // STEP 3: REFLECT - Analyze and produce section updates
    // ──────────────────────────────────────────────────────────

    await checkAborted();
    console.log(`[Research] STEP 3: REFLECT`);

    emitProgress('reasoning_started');

    const reflectionResult = await analyzeAndReflect({
      currentDoc: formatDocForAgent(doc),
      rawFindings: searchResult.findings,
      objective: doc.objective,
      doneWhen: doc.doneWhen,
      abortSignal,
      onProgress: (update) => {
        emitProgress(update.type, update);
      }
    });

    totalCreditsUsed += reflectionResult.creditsUsed;

    console.log(`[Research] Reflection complete: ${reflectionResult.output.edits.length} edits, shouldContinue=${reflectionResult.output.shouldContinue}`);
    console.log(`[Research] Edits:`, JSON.stringify(reflectionResult.output.edits, null, 2));
    console.log(`[Research] Reasoning:`, reflectionResult.output.reasoning?.substring(0, 200));

    // ──────────────────────────────────────────────────────────
    // STEP 4: UPDATE - Apply section updates to document
    // ──────────────────────────────────────────────────────────

    console.log(`[Research] STEP 4: UPDATE DOCUMENT`);

    doc = applyReflectionOutput(doc, reflectionResult.output);
    await saveDocToDb(doc);

    // Emit section updates for UI based on edits
    const editedSections = new Set(reflectionResult.output.edits.map(e => e.sectionTitle));
    for (const sectionTitle of editedSections) {
      const section = doc.sections.find(s => s.title === sectionTitle);
      if (section) {
        emitProgress('section_updated', {
          sectionTitle,
          section
        });
      }
    }

    emitProgress('doc_updated', {
      doc: {
        objective: doc.objective,
        doneWhen: doc.doneWhen,
        sections: doc.sections,
        strategyLog: doc.strategyLog
      },
      editsApplied: reflectionResult.output.edits.length,
      reasoning: reflectionResult.output.reasoning
    });

    // ──────────────────────────────────────────────────────────
    // STEP 5: CHECK - Is doneWhen satisfied?
    // ──────────────────────────────────────────────────────────

    console.log(`[Research] STEP 5: CHECK DONE`);

    if (!reflectionResult.output.shouldContinue) {
      console.log('[Research] Reflection agent says we are done');
      researchDone = true;
    }

    emitProgress('research_iteration', {
      iteration: iterationCount,
      searchCount,
      isDone: researchDone,
      reasoning: reflectionResult.output.reasoning
    });
  }

  // ============================================================
  // PHASE 3: ADVERSARIAL REVIEW
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 3: ADVERSARIAL REVIEW');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();
  emitProgress('review_started');

  const model = openai('gpt-5.1');

  const reviewTool = tool({
    description: 'Deliver your adversarial review verdict',
    inputSchema: z.object({
      verdict: z.enum(['pass', 'fail']).describe('pass = research is sufficient, fail = gaps remain'),
      critique: z.string().describe('Why this passes or fails. Be specific.'),
      missing: z.array(z.string()).describe('What specific gaps remain (empty if pass)')
    }),
    execute: async ({ verdict, critique, missing }) => {
      return { verdict, critique, missing };
    }
  });

  const reviewResult = await generateText({
    model,
    system: `You are a hostile reviewer. Your job is to block weak conclusions.
Assume the researcher is wrong unless proven otherwise.
Golden word is: relevance. How "relevant" is the output we provide to the user?

OBJECTIVE: ${doc.objective}
DONE_WHEN: ${doc.doneWhen}

RESEARCH DOCUMENT:
${formatDocForAgent(doc)}

Evaluate harshly. Is DONE_WHEN actually satisfied?
- If the evidence is weak or doesn't match DONE_WHEN → FAIL
- If solid evidence supports the stopping condition → PASS`,
    prompt: 'Review this research. Use the review tool to deliver your verdict.',
    tools: { review: reviewTool },
    toolChoice: { type: 'tool', toolName: 'review' },
    abortSignal
  });

  const reviewToolCall = reviewResult.toolCalls?.[0] as any;
  const reviewVerdict = reviewToolCall?.input || reviewToolCall?.args || { verdict: 'pass', critique: '', missing: [] };

  emitProgress('review_completed', {
    verdict: reviewVerdict.verdict,
    critique: reviewVerdict.critique,
    missing: reviewVerdict.missing
  });

  console.log(`[Research] Review verdict: ${reviewVerdict.verdict}`);

  // If review fails and we have iterations left, force another cycle
  if (reviewVerdict.verdict === 'fail' && iterationCount < MAX_ITERATIONS - 1) {
    console.log('[Research] Review failed - forcing additional research cycle');
    emitProgress('review_rejected', {
      critique: reviewVerdict.critique,
      missing: reviewVerdict.missing
    });

    // Append new strategy to address gaps
    const gapStrategy = {
      approach: 'Addressing reviewer gaps',
      rationale: reviewVerdict.critique,
      nextActions: reviewVerdict.missing.length > 0
        ? reviewVerdict.missing.map((m: string) => `Address gap: ${m}`)
        : ['Address reviewer critique']
    };
    doc = appendStrategy(doc, gapStrategy);

    await saveDocToDb(doc);

    // Run one more search + reflect cycle
    iterationCount++;

    const gapSearchTask = createSearchTask(
      gapStrategy.nextActions[0],
      getDocSummary(doc),
      doc.objective,
      doc.doneWhen,
      doc.queriesRun
    );

    const gapSearchResult = await executeSearch({
      task: gapSearchTask,
      abortSignal,
      onProgress: (update) => emitProgress(update.type, update)
    });

    totalCreditsUsed += gapSearchResult.creditsUsed;
    doc = addQueriesToDoc(doc, gapSearchResult.queriesExecuted);

    const gapReflectionResult = await analyzeAndReflect({
      currentDoc: formatDocForAgent(doc),
      rawFindings: gapSearchResult.findings,
      objective: doc.objective,
      doneWhen: doc.doneWhen,
      abortSignal,
      onProgress: (update) => emitProgress(update.type, update)
    });

    totalCreditsUsed += gapReflectionResult.creditsUsed;
    doc = applyReflectionOutput(doc, gapReflectionResult.output);
    await saveDocToDb(doc);

    emitProgress('doc_updated', {
      doc: {
        objective: doc.objective,
        doneWhen: doc.doneWhen,
        sections: doc.sections,
        strategyLog: doc.strategyLog
      },
      editsApplied: gapReflectionResult.output.edits.length,
      reasoning: 'Addressing reviewer gaps'
    });
  }

  // ============================================================
  // PHASE 4: FINISH - Generate final answer
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 4: FINISH');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();
  emitProgress('synthesizing_started');

  const finishTool = tool({
    description: 'Deliver your final research answer',
    inputSchema: z.object({
      confidenceLevel: z.enum(['low', 'medium', 'high']),
      finalAnswer: z.string().describe('Complete answer to the research objective'),
      doneWhenStatus: z.string().describe('Explain how DONE_WHEN was satisfied or why it was impossible')
    }),
    execute: async ({ confidenceLevel, finalAnswer, doneWhenStatus }) => {
      return { confidenceLevel, finalAnswer, doneWhenStatus };
    }
  });

  const finishResult = await generateText({
    model,
    system: `You are synthesizing the final research answer.

OBJECTIVE: ${doc.objective}
DONE_WHEN: ${doc.doneWhen}

RESEARCH DOCUMENT:
${formatDocForAgent(doc)}

REVIEWER NOTES: ${reviewVerdict.critique}

Synthesize a comprehensive final answer based on the document.`,
    prompt: 'Synthesize your final answer. Use the finish tool.',
    tools: { finish: finishTool },
    toolChoice: { type: 'tool', toolName: 'finish' },
    abortSignal
  });

  const finishToolCall = finishResult.toolCalls?.[0] as any;
  const output = finishToolCall?.input || finishToolCall?.args || {
    confidenceLevel: 'low',
    finalAnswer: 'Research completed but no answer extracted.',
    doneWhenStatus: 'Unknown'
  };

  // ============================================================
  // COMPLETE
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log(`[Research] COMPLETE`);
  console.log(`[Research] Iterations: ${iterationCount}, Searches: ${searchCount}`);
  console.log('[Research] ═══════════════════════════════════════════════════');

  emitProgress('research_complete', {
    totalSteps: iterationCount,
    totalSearches: searchCount,
    confidence: output.confidenceLevel
  });

  return {
    completed: true,
    iterations: iterationCount,
    creditsUsed: totalCreditsUsed,
    output
  };
}
