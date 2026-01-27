/**
 * Tree Research Runner - Event-driven orchestration
 *
 * Key difference from old runner:
 * - No batch waiting - cortex reacts when ANY node completes
 * - Nodes can be attached anywhere in the tree
 * - Queue-based processing prevents race conditions
 */

import {
  TreeResearchState,
  ResearchNode,
  createTreeResearchState,
  buildNodeContext,
  countByStatus,
} from './tree-types';
import * as cortex from './cortex';
import { runTreeNode } from './tree-researcher';

// ============================================================
// Types
// ============================================================

interface CompletionEvent {
  nodeId: string;
  finalDoc: string;
  confidence: 'low' | 'medium' | 'high';
  searchHistory: import('./tree-types').SearchEvent[];
  suggestedFollowups: Array<{ question: string; reason: string }>;
}

interface RunConfig {
  maxNodes?: number;      // Max total nodes (default 20)
  maxTimeMs?: number;     // Max runtime (default 10 min)
  maxDepth?: number;      // Max tree depth (default 5)
  signal?: AbortSignal;   // Abort signal to stop research
  onStateChange?: (state: TreeResearchState) => void;
  onNodeStart?: (node: ResearchNode) => void;
  onNodeComplete?: (node: ResearchNode) => void;
}

// ============================================================
// Main Runner
// ============================================================

export async function runTreeResearch(
  objective: string,
  successCriteria?: string[],
  config: RunConfig = {}
): Promise<TreeResearchState> {
  const {
    maxNodes = 20,
    maxTimeMs = 10 * 60 * 1000,
    maxDepth = 5,
    signal,
    onStateChange,
    onNodeStart,
    onNodeComplete,
  } = config;

  const startTime = Date.now();
  let state = createTreeResearchState(objective, successCriteria);

  // Completion queue - nodes push here when done
  const completionQueue: CompletionEvent[] = [];
  const runningPromises = new Map<string, Promise<void>>();

  // Helper to notify state changes
  const emitStateChange = () => onStateChange?.(state);

  // Helper to check limits and abort
  const withinLimits = () => {
    if (signal?.aborted) return false;
    const elapsed = Date.now() - startTime;
    const nodeCount = Object.keys(state.nodes).length;
    return elapsed < maxTimeMs && nodeCount < maxNodes;
  };

  // Helper to check if aborted
  const isAborted = () => signal?.aborted ?? false;

  // Helper to get node depth
  const getDepth = (nodeId: string): number => {
    let depth = 0;
    let current = state.nodes[nodeId];
    while (current?.parentId) {
      depth++;
      current = state.nodes[current.parentId];
    }
    return depth;
  };

  // Helper to update node's searchHistory in-place
  const updateNodeSearchHistory = (nodeId: string, searchHistory: import('./tree-types').SearchEvent[]) => {
    state = {
      ...state,
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          searchHistory: [...searchHistory],
        },
      },
    };
    emitStateChange();
  };

  // Start a node running
  const startNode = async (nodeId: string) => {
    state = cortex.markNodeRunning(state, nodeId);
    emitStateChange();

    const node = state.nodes[nodeId];
    onNodeStart?.(node);

    const context = buildNodeContext(state, nodeId);

    try {
      const result = await runTreeNode(context, {
        signal,
        onProgress: (searchHistory) => {
          updateNodeSearchHistory(nodeId, searchHistory);
        },
      });
      completionQueue.push({
        nodeId,
        finalDoc: result.finalDoc,
        confidence: result.confidence,
        searchHistory: result.searchHistory,
        suggestedFollowups: result.suggestedFollowups,
      });
    } catch (error) {
      // On error, mark as done with low confidence
      completionQueue.push({
        nodeId,
        finalDoc: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidence: 'low',
        searchHistory: state.nodes[nodeId].searchHistory || [],
        suggestedFollowups: [],
      });
    }
  };

  // Process one completion from queue
  const processCompletion = async (): Promise<boolean> => {
    const event = completionQueue.shift();
    if (!event) return false;

    // Update state with completion (including searchHistory and suggestions)
    state = cortex.markNodeDone(
      state,
      event.nodeId,
      event.finalDoc,
      event.confidence,
      event.searchHistory,
      event.suggestedFollowups
    );
    emitStateChange();

    const node = state.nodes[event.nodeId];
    onNodeComplete?.(node);

    // Ask cortex what to do next
    const decision = await cortex.evaluate(state, event.nodeId);

    state.cortex.history = [
      ...(state.cortex.history || []),
      { type: 'decide' as const, reasoning: decision.reasoning, action: decision.decision },
    ];

    if (decision.decision === 'done') {
      return true; // Signal to finish
    }

    // Spawn new nodes (filtering by depth limit)
    if (decision.nodesToSpawn.length > 0 && withinLimits()) {
      const validNodes = decision.nodesToSpawn.filter((n) => {
        if (!n.parentId) return true; // Root nodes always ok
        return getDepth(n.parentId) < maxDepth - 1;
      });

      if (validNodes.length > 0) {
        const { state: newState, spawnedIds } = cortex.spawnNodes(state, validNodes);
        state = newState;
        emitStateChange();

        // Start the new nodes
        for (const id of spawnedIds) {
          const promise = startNode(id);
          runningPromises.set(id, promise);
          promise.finally(() => runningPromises.delete(id));
        }
      }
    }

    return false;
  };

  // ============================================================
  // Main Loop
  // ============================================================

  // 1. Initial cortex decision (spawn first nodes)
  const initialDecision = await cortex.evaluate(state);

  if (initialDecision.decision === 'done' || initialDecision.nodesToSpawn.length === 0) {
    // Nothing to research
    state.cortex.status = 'done';
    state.cortex.finalAnswer = 'No research needed.';
    return state;
  }

  // Spawn initial nodes
  const { state: stateWithInitial, spawnedIds: initialIds } = cortex.spawnNodes(
    state,
    initialDecision.nodesToSpawn
  );
  state = stateWithInitial;
  emitStateChange();

  // Start initial nodes
  for (const id of initialIds) {
    const promise = startNode(id);
    runningPromises.set(id, promise);
    promise.finally(() => runningPromises.delete(id));
  }

  // 2. Event loop - process completions as they arrive
  while (state.cortex.status === 'running' && withinLimits()) {
    // Wait for something to complete
    if (completionQueue.length === 0 && runningPromises.size > 0) {
      await Promise.race(Array.from(runningPromises.values()));
      continue;
    }

    // Process completions one at a time (prevents duplicates)
    if (completionQueue.length > 0) {
      const shouldFinish = await processCompletion();
      if (shouldFinish) break;
      continue;
    }

    // Nothing running and nothing in queue - we're done
    if (runningPromises.size === 0) {
      break;
    }
  }

  // 3. If aborted, don't wait for remaining nodes
  if (isAborted()) {
    state = cortex.finishResearch(state, 'Research was stopped by user.');
    emitStateChange();
    return state;
  }

  // 4. Wait for any remaining nodes to finish
  if (runningPromises.size > 0 && !isAborted()) {
    await Promise.all(Array.from(runningPromises.values()));
    // Process remaining completions
    while (completionQueue.length > 0 && !isAborted()) {
      await processCompletion();
    }
  }

  // 5. Synthesize final answer (unless aborted)
  if (isAborted()) {
    state = cortex.finishResearch(state, 'Research was stopped by user.');
  } else {
    const finishResult = await cortex.finish(state);
    state = cortex.finishResearch(state, finishResult.answer);
  }
  emitStateChange();

  return state;
}
