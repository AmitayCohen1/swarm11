/**
 * Research Runner - Event-driven tree orchestration
 *
 * Key design:
 * - No batch waiting - cortex reacts when ANY node completes
 * - Nodes can be attached anywhere in the tree
 * - Queue-based processing prevents race conditions
 */

import {
  ResearchState,
  ResearchNode,
  SearchEntry,
  Followup,
  createInitialState,
  buildNodeContext,
  countByStatus,
  getNodeDepth,
  RESEARCH_LIMITS,
} from './types';
import * as cortex from './cortex';
import { runNode } from './researcher';

// ============================================================
// Types
// ============================================================

interface CompletionEvent {
  nodeId: string;
  answer: string;
  confidence: 'low' | 'medium' | 'high';
  searches: SearchEntry[];
  suggestedFollowups: Followup[];
  tokens: number;
}

export interface RunConfig {
  maxNodes?: number;
  maxTimeMs?: number;
  maxDepth?: number;
  signal?: AbortSignal;
  onStateChange?: (state: ResearchState) => void;
  onNodeStart?: (node: ResearchNode) => void;
  onNodeComplete?: (node: ResearchNode) => void;
}

// ============================================================
// Main Runner
// ============================================================

export async function runResearch(
  objective: string,
  successCriteria?: string[],
  config: RunConfig = {}
): Promise<ResearchState> {
  const {
    maxNodes = RESEARCH_LIMITS.maxNodes,
    maxTimeMs = RESEARCH_LIMITS.maxTimeMs,
    maxDepth = RESEARCH_LIMITS.maxDepth,
    signal,
    onStateChange,
    onNodeStart,
    onNodeComplete,
  } = config;

  const startTime = Date.now();
  let state = createInitialState(objective, successCriteria);

  // Completion queue
  const completionQueue: CompletionEvent[] = [];
  const runningPromises = new Map<string, Promise<void>>();

  // Helpers
  const emit = () => onStateChange?.(state);
  const isAborted = () => signal?.aborted ?? false;
  const withinLimits = () => {
    if (isAborted()) return false;
    const elapsed = Date.now() - startTime;
    const nodeCount = Object.keys(state.nodes).length;
    return elapsed < maxTimeMs && nodeCount < maxNodes;
  };

  // Update node's searches in real-time
  const updateNodeSearches = (nodeId: string, searches: SearchEntry[]) => {
    state = {
      ...state,
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...state.nodes[nodeId],
          searches: [...searches],
        },
      },
    };
    emit();
  };

  // Start a node
  const startNode = async (nodeId: string) => {
    state = cortex.markNodeRunning(state, nodeId);
    emit();

    const node = state.nodes[nodeId];
    onNodeStart?.(node);

    const context = buildNodeContext(state, nodeId);

    try {
      const result = await runNode(context, {
        signal,
        onProgress: (searches) => updateNodeSearches(nodeId, searches),
      });
      completionQueue.push({
        nodeId,
        answer: result.answer,
        confidence: result.confidence,
        searches: result.searches,
        suggestedFollowups: result.suggestedFollowups,
        tokens: result.tokens,
      });
    } catch (error) {
      completionQueue.push({
        nodeId,
        answer: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidence: 'low',
        searches: state.nodes[nodeId].searches || [],
        suggestedFollowups: [],
        tokens: 0,
      });
    }
  };

  // Process one completion
  const processCompletion = async (): Promise<boolean> => {
    const event = completionQueue.shift();
    if (!event) return false;

    state = cortex.markNodeDone(
      state,
      event.nodeId,
      event.answer,
      event.confidence,
      event.searches,
      event.suggestedFollowups,
      event.tokens
    );
    emit();

    const node = state.nodes[event.nodeId];
    onNodeComplete?.(node);

    // Ask cortex what to do
    const decision = await cortex.evaluate(state, event.nodeId);

    // Apply finding updates first
    if (decision.findingUpdates && decision.findingUpdates.length > 0) {
      state = cortex.applyFindingUpdates(state, decision.findingUpdates);
    }

    state = {
      ...state,
      totalTokens: (state.totalTokens || 0) + decision.tokens,
      decisions: [
        ...(state.decisions || []),
        { timestamp: Date.now(), type: 'complete', reasoning: decision.reasoning, tokens: decision.tokens },
      ],
    };
    emit();

    if (decision.decision === 'done') {
      return true; // Signal to finish
    }

    // Spawn new nodes
    if (decision.nodesToSpawn.length > 0 && withinLimits()) {
      const validNodes = decision.nodesToSpawn.filter((n) => {
        if (!n.parentId) return true;
        return getNodeDepth(state, n.parentId) < maxDepth - 1;
      });

      if (validNodes.length > 0) {
        const { state: newState, spawnedIds } = cortex.spawnNodes(state, validNodes);
        state = newState;
        emit();

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

  // 1. Initial cortex decision
  const initialDecision = await cortex.evaluate(state);

  // Apply any initial finding updates
  if (initialDecision.findingUpdates && initialDecision.findingUpdates.length > 0) {
    state = cortex.applyFindingUpdates(state, initialDecision.findingUpdates);
  }

  state = {
    ...state,
    totalTokens: (state.totalTokens || 0) + initialDecision.tokens,
    decisions: [
      ...(state.decisions || []),
      { timestamp: Date.now(), type: 'spawn', reasoning: initialDecision.reasoning, tokens: initialDecision.tokens },
    ],
  };
  emit();

  if (initialDecision.decision === 'done' || initialDecision.nodesToSpawn.length === 0) {
    state.status = 'complete';
    state.finalAnswer = 'No research needed.';
    return state;
  }

  // Spawn initial nodes
  const { state: stateWithInitial, spawnedIds: initialIds } = cortex.spawnNodes(
    state,
    initialDecision.nodesToSpawn
  );
  state = stateWithInitial;
  emit();

  // Start initial nodes
  for (const id of initialIds) {
    const promise = startNode(id);
    runningPromises.set(id, promise);
    promise.finally(() => runningPromises.delete(id));
  }

  // 2. Event loop
  while (state.status === 'running' && withinLimits()) {
    if (completionQueue.length === 0 && runningPromises.size > 0) {
      await Promise.race(Array.from(runningPromises.values()));
      continue;
    }

    if (completionQueue.length > 0) {
      const shouldFinish = await processCompletion();
      if (shouldFinish) break;
      continue;
    }

    if (runningPromises.size === 0) break;
  }

  // 3. Handle abort
  if (isAborted()) {
    state = cortex.stopResearch(state);
    emit();
    return state;
  }

  // 4. Wait for remaining nodes (but don't spawn more - we're finishing)
  if (runningPromises.size > 0 && !isAborted()) {
    await Promise.all(Array.from(runningPromises.values()));
    // Just collect results, don't ask cortex to spawn more
    while (completionQueue.length > 0 && !isAborted()) {
      const event = completionQueue.shift();
      if (event) {
        state = cortex.markNodeDone(
          state,
          event.nodeId,
          event.answer,
          event.confidence,
          event.searches,
          event.suggestedFollowups,
          event.tokens
        );
        emit();
        onNodeComplete?.(state.nodes[event.nodeId]);
      }
    }
  }

  // 5. Mark complete (findings doc is the output - no synthesis needed)
  if (isAborted()) {
    state = cortex.stopResearch(state);
  } else {
    // Format findings as final answer
    const findings = state.findings || [];
    const finalAnswer = findings.length > 0
      ? findings.map(f => `**${f.title}**\n${f.content}`).join('\n\n')
      : 'No findings were extracted during research.';

    state = cortex.finishResearch(state, finalAnswer);
  }
  emit();

  return state;
}
