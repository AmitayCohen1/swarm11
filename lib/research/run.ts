/**
 * Research Run - Tree-based orchestration
 *
 * Replaces old batch-based approach with event-driven tree research.
 */

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ResearchBrief } from '@/lib/agents/intake-agent';
import { runTreeResearch } from './tree-runner';
import { TreeResearchState, ResearchNode } from './tree-types';

// ============================================================
// Types (same interface as before for compatibility)
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
// Transform tree state to frontend-compatible format
// ============================================================

function toFrontendFormat(state: TreeResearchState): any {
  const nodes = Object.values(state.nodes);

  // Transform nodes to question-like format for frontend
  const questions = nodes.map((node) => {
    // Build memory from search history
    const memory: any[] = [];
    for (const event of node.searchHistory || []) {
      if (event.type === 'search') {
        memory.push({ type: 'search', query: event.query });
        memory.push({ type: 'result', answer: event.answer, sources: event.sources || [] });
      } else if (event.type === 'reflect') {
        memory.push({ type: 'reflect', thought: event.thought });
      }
    }

    // Find depth (for "round" equivalent)
    let depth = 0;
    let current: ResearchNode | undefined = node;
    while (current?.parentId) {
      depth++;
      current = state.nodes[current.parentId];
    }

    return {
      id: node.id,
      parentId: node.parentId,
      researchRound: depth + 1,
      name: node.question.substring(0, 30) + (node.question.length > 30 ? '...' : ''),
      question: node.question,
      description: node.reason,
      goal: node.reason,
      status: node.status,
      cycles: memory.filter((m) => m.type === 'search').length,
      maxCycles: 15,
      memory,
      confidence: node.confidence || null,
      recommendation: null,
      summary: node.finalDoc?.substring(0, 200),
      document: node.finalDoc
        ? {
            answer: node.finalDoc,
            keyFindings: [],
            sources: [],
            limitations: '',
          }
        : undefined,
    };
  });

  // Build brain log from cortex history
  const brainLog = (state.cortex.history || [])
    .map((event, idx) => {
      if (event.type === 'spawn') {
        return {
          id: `spawn_${idx}`,
          timestamp: new Date().toISOString(),
          action: 'spawn',
          reasoning: `Spawned "${event.question}" - ${event.reason}`,
          nodeId: event.nodeId,
          parentId: event.parentId,
        };
      }
      if (event.type === 'decide') {
        return {
          id: `dec_${idx}`,
          timestamp: new Date().toISOString(),
          action: event.action === 'done' ? 'synthesize' : 'evaluate',
          reasoning: event.reasoning,
        };
      }
      return null;
    })
    .filter(Boolean);

  // Build tree structure for visualization
  const tree = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    question: n.question,
    status: n.status,
    confidence: n.confidence,
  }));

  return {
    version: 2, // New tree-based version
    objective: state.cortex.objective,
    successCriteria: state.cortex.successCriteria || [],
    questions,
    brainLog,
    tree,
    status: state.cortex.status === 'done' ? 'complete' : 'running',
    finalAnswer: state.cortex.finalAnswer,
  };
}

// ============================================================
// Abort Controller Registry
// ============================================================

const abortControllers = new Map<string, AbortController>();

export function stopResearch(sessionId: string): boolean {
  console.log(`[TreeResearch] Stop requested for session ${sessionId}`);
  console.log(`[TreeResearch] Active sessions: ${Array.from(abortControllers.keys()).join(', ') || 'none'}`);

  const controller = abortControllers.get(sessionId);
  if (controller) {
    controller.abort();
    abortControllers.delete(sessionId);
    console.log(`[TreeResearch] ✓ Aborted research for session ${sessionId}`);
    return true;
  }
  console.log(`[TreeResearch] ✗ No active research found for session ${sessionId}`);
  return false;
}

// ============================================================
// Main Entry Point
// ============================================================

export async function runResearch(config: RunConfig): Promise<RunResult> {
  const { chatSessionId, researchBrief, onProgress } = config;

  // Create abort controller for this session
  const abortController = new AbortController();
  abortControllers.set(chatSessionId, abortController);
  console.log(`[TreeResearch] Registered abort controller for session ${chatSessionId}`);

  const log = (msg: string, data?: any) => {
    console.log(`[TreeResearch] ${msg}`, data ? JSON.stringify(data).substring(0, 200) : '');
  };

  // Helper to save state to DB
  const save = async (state: TreeResearchState) => {
    const frontendDoc = toFrontendFormat(state);
    const serialized = JSON.stringify(frontendDoc);
    await db
      .update(chatSessions)
      .set({ brain: serialized, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    onProgress?.({ type: 'brain_update', brain: serialized });
  };

  log('Starting tree research', { objective: researchBrief.objective });
  onProgress?.({ type: 'research_initialized', objective: researchBrief.objective });

  // Run tree-based research
  const result = await runTreeResearch(
    researchBrief.objective,
    researchBrief.successCriteria,
    {
      maxNodes: 20,
      maxTimeMs: 10 * 60 * 1000, // 10 min
      maxDepth: 4,
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
          answerLength: node.finalDoc?.length || 0,
        });
      },
    }
  );

  // Clean up abort controller
  abortControllers.delete(chatSessionId);

  // Final save
  await save(result);

  const wasStopped = abortController.signal.aborted;

  log(wasStopped ? 'Research stopped' : 'Research complete', {
    totalNodes: Object.keys(result.nodes).length,
    answerLength: result.cortex.finalAnswer?.length || 0,
  });

  onProgress?.({
    type: wasStopped ? 'research_stopped' : 'research_complete',
    totalQuestions: Object.keys(result.nodes).length,
    answerLength: result.cortex.finalAnswer?.length || 0,
  });

  return {
    completed: !wasStopped,
    totalQuestions: Object.keys(result.nodes).length,
    output: { finalAnswer: result.cortex.finalAnswer || 'Research complete.' },
  };
}
