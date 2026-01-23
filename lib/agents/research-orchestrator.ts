/**
 * Research Executor Agent - Unified Architecture
 *
 * Orchestrates the research loop using a single unified Research Agent
 * that handles both searching and document updates.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { db } from '@/lib/db';
import { chatSessions, searchQueries } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ResearchBrief } from './intake-agent';
import { executeResearchCycle } from './research-agent';
import {
  createResearchDoc,
  formatDocForAgent,
  serializeDoc,
  parseBrainToDoc,
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
 * Research Executor - Unified Loop
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

  const MAX_CYCLES = 10;

  let totalCreditsUsed = 0;
  let cycleCount = 0;
  let totalQueries = 0;

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

  let doc: ResearchDoc;
  const existingDoc = parseBrainToDoc(existingBrain);

  if (existingDoc) {
    console.log('[Research] Continuing with existing document (v4)');
    doc = existingDoc;
  } else {
    console.log('[Research] Creating new research document');
    doc = createResearchDoc(
      researchBrief.objective,
      researchBrief.initialStrategy,
      researchBrief.initialPhases
    );
  }

  await saveDocToDb(doc);

  emitProgress('research_initialized', {
    objective: doc.objective,
    version: 6
  });

  emitProgress('doc_updated', {
    doc: {
      objective: doc.objective,
      phases: doc.phases,
      strategyLog: doc.strategyLog
    }
  });

  // ============================================================
  // PHASE 2: UNIFIED RESEARCH CYCLES
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 2: RESEARCH CYCLES');
  console.log('[Research] ═══════════════════════════════════════════════════');

  let researchDone = false;

  while (!researchDone && cycleCount < MAX_CYCLES) {
    cycleCount++;
    await checkAborted();

    console.log('[Research] ───────────────────────────────────────────────────');
    console.log(`[Research] CYCLE ${cycleCount}`);

    const currentStrategy = getCurrentStrategy(doc);
    emitProgress('cycle_started', {
      cycle: cycleCount,
      strategy: currentStrategy
    });

    // Run unified research cycle
    const cycleResult = await executeResearchCycle({
      doc,
      objective: doc.objective,
      maxIterations: 15,
      abortSignal,
      onProgress: (update) => {
        emitProgress(update.type, update);
      }
    });

    doc = cycleResult.doc;
    totalCreditsUsed += cycleResult.creditsUsed;
    totalQueries += cycleResult.queriesExecuted.length;

    // Track queries in DB
    for (const query of cycleResult.queriesExecuted) {
      await db.insert(searchQueries).values({
        researchSessionId,
        query,
        queryNormalized: query.toLowerCase().trim(),
        purpose: '',
        answer: '',
        sources: [],
        cycleNumber: cycleCount
      }).onConflictDoNothing();
    }

    await saveDocToDb(doc);

    console.log(`[Research] Cycle complete: ${cycleResult.queriesExecuted.length} queries, shouldContinue=${cycleResult.shouldContinue}`);

    emitProgress('doc_updated', {
      doc: {
        objective: doc.objective,
        phases: doc.phases,
        strategyLog: doc.strategyLog
      }
    });

    emitProgress('cycle_completed', {
      cycle: cycleCount,
      queries: cycleResult.queriesExecuted.length,
      shouldContinue: cycleResult.shouldContinue
    });

    if (!cycleResult.shouldContinue) {
      console.log('[Research] Research agent signaled done');
      researchDone = true;
    }
  }

  // ============================================================
  // PHASE 3: ADVERSARIAL REVIEW
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 3: ADVERSARIAL REVIEW');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();
  emitProgress('review_started');

  const model = openai('gpt-4.1');

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

RESEARCH DOCUMENT:
${formatDocForAgent(doc)}

Evaluate harshly. Does the research actually address the objective?
- If the evidence is weak or irrelevant → FAIL
- If solid evidence addresses the objective → PASS`,
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

  // If review fails and we have cycles left, run one more
  if (reviewVerdict.verdict === 'fail' && cycleCount < MAX_CYCLES) {
    console.log('[Research] Review failed - running additional cycle');
    emitProgress('review_rejected', {
      critique: reviewVerdict.critique,
      missing: reviewVerdict.missing
    });

    const gapStrategy = {
      approach: 'Addressing reviewer gaps',
      rationale: reviewVerdict.critique,
      nextActions: reviewVerdict.missing.length > 0
        ? reviewVerdict.missing.slice(0, 3)
        : ['Address reviewer critique']
    };
    doc = appendStrategy(doc, gapStrategy);

    cycleCount++;

    const gapResult = await executeResearchCycle({
      doc,
      objective: doc.objective,
      maxIterations: 10,
      abortSignal,
      onProgress: (update) => emitProgress(update.type, update)
    });

    doc = gapResult.doc;
    totalCreditsUsed += gapResult.creditsUsed;
    totalQueries += gapResult.queriesExecuted.length;

    await saveDocToDb(doc);

    emitProgress('doc_updated', {
      doc: {
        objective: doc.objective,
        phases: doc.phases,
        strategyLog: doc.strategyLog
      }
    });
  }

  // ============================================================
  // PHASE 4: FINISH
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
      finalAnswer: z.string().describe('Complete answer to the research objective')
    }),
    execute: async ({ confidenceLevel, finalAnswer }) => {
      return { confidenceLevel, finalAnswer };
    }
  });

  const finishResult = await generateText({
    model,
    system: `You are synthesizing the final research answer.

OBJECTIVE: ${doc.objective}

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
    finalAnswer: 'Research completed but no answer extracted.'
  };

  // ============================================================
  // COMPLETE
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log(`[Research] COMPLETE`);
  console.log(`[Research] Cycles: ${cycleCount}, Queries: ${totalQueries}`);
  console.log('[Research] ═══════════════════════════════════════════════════');

  emitProgress('research_complete', {
    totalCycles: cycleCount,
    totalSearches: totalQueries,
    confidence: output.confidenceLevel
  });

  return {
    completed: true,
    cycles: cycleCount,
    creditsUsed: totalCreditsUsed,
    output
  };
}
