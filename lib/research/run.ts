/**
 * Research Entry Point
 *
 * Connects research system to:
 * - Database (saves state)
 * - SSE streaming (progress updates)
 * - Abort handling
 */

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ResearchBrief } from '@/lib/agents/intake-agent';
import { runResearch as runResearchCore } from './runner';
import { ResearchState } from './types';

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
// Abort Controller Registry
// ============================================================

const abortControllers = new Map<string, AbortController>();

export function stopResearch(sessionId: string): boolean {
  console.log(`[Research] Stop requested for session ${sessionId}`);
  const controller = abortControllers.get(sessionId);
  if (controller) {
    controller.abort();
    abortControllers.delete(sessionId);
    console.log(`[Research] ✓ Aborted session ${sessionId}`);
    return true;
  }
  console.log(`[Research] ✗ No active session ${sessionId}`);
  return false;
}

// ============================================================
// Main Entry Point
// ============================================================

export async function runResearch(config: RunConfig): Promise<RunResult> {
  const { chatSessionId, researchBrief, onProgress } = config;

  // Create abort controller
  const abortController = new AbortController();
  abortControllers.set(chatSessionId, abortController);

  const log = (msg: string, data?: any) => {
    console.log(`[Research] ${msg}`, data ? JSON.stringify(data).substring(0, 200) : '');
  };

  // Save state to DB and emit progress
  const save = async (state: ResearchState) => {
    const serialized = JSON.stringify(state);
    await db
      .update(chatSessions)
      .set({ brain: serialized, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    onProgress?.({ type: 'brain_update', brain: serialized });
  };

  log('Starting research', { objective: researchBrief.objective });
  onProgress?.({ type: 'research_initialized', objective: researchBrief.objective });

  try {
    // Run research
    const result = await runResearchCore(
      researchBrief.objective,
      researchBrief.successCriteria,
      {
        signal: abortController.signal,

        onStateChange: async (state) => {
          await save(state);
        },

        onNodeStart: (node) => {
          log('Node started', { id: node.id, question: node.question });
          onProgress?.({
            type: 'question_started',
            questionId: node.id,
            questionText: node.question,
            parentId: node.parentId,
          });
        },

        onNodeComplete: (node) => {
          log('Node complete', { id: node.id, confidence: node.confidence });
          onProgress?.({
            type: 'question_done',
            questionId: node.id,
            confidence: node.confidence,
            answerLength: node.answer?.length || 0,
          });
        },

        onDecision: (decision, reasoning) => {
          log('Cortex decision', { decision, reasoning });
          onProgress?.({
            type: 'brain_decision',
            decision,
            reasoning,
          });
        },
      }
    );

    // Final save
    await save(result);

    const wasStopped = abortController.signal.aborted;

    log(wasStopped ? 'Research stopped' : 'Research complete', {
      totalNodes: Object.keys(result.nodes).length,
      answerLength: result.finalAnswer?.length || 0,
    });

    onProgress?.({
      type: wasStopped ? 'research_stopped' : 'research_complete',
      totalQuestions: Object.keys(result.nodes).length,
      answerLength: result.finalAnswer?.length || 0,
    });

    return {
      completed: !wasStopped,
      totalQuestions: Object.keys(result.nodes).length,
      output: { finalAnswer: result.finalAnswer || 'Research complete.' },
    };
  } finally {
    // Always clean up abort controller
    abortControllers.delete(chatSessionId);
  }
}
