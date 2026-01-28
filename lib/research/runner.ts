/**
 * Research Runner - The Simple Loop
 *
 * 1. Cortex starts → initial nodes
 * 2. Nodes run (parallel)
 * 3. Node completes → Cortex decides (findings, followups, done?)
 * 4. Repeat until done
 * 5. Cortex finishes → final answer
 */

import * as cortex from './cortex';
import { runNode } from './researcher';
import {
  ResearchState,
  ResearchNode,
  buildNodeContext,
  countByStatus,
  RESEARCH_LIMITS,
} from './types';

// ============================================================
// Types
// ============================================================

export interface RunConfig {
  signal?: AbortSignal;
  onStateChange?: (state: ResearchState) => Promise<void>;
  onNodeStart?: (node: ResearchNode) => void;
  onNodeComplete?: (node: ResearchNode) => void;
  onDecision?: (decision: string, reasoning: string) => void;
}

interface NodeCompleteEvent {
  nodeId: string;
  answer: string;
  confidence: 'low' | 'medium' | 'high';
  suggestedFollowups: Array<{ question: string; reason: string }>;
  searches: any[];
  tokens: number;
}

// ============================================================
// Main Entry Point
// ============================================================

export async function runResearch(
  objective: string,
  successCriteria: string[] | undefined,
  config: RunConfig = {}
): Promise<ResearchState> {
  const { signal, onStateChange, onNodeStart, onNodeComplete, onDecision } = config;

  const isAborted = () => signal?.aborted ?? false;
  const emit = async (state: ResearchState) => {
    if (onStateChange) await onStateChange(state);
  };

  // ──────────────────────────────────────────────────────────
  // 1. START: Cortex creates initial nodes
  // ──────────────────────────────────────────────────────────

  const startResult = await cortex.start(objective, successCriteria);
  let state = startResult.state;

  onDecision?.('start', startResult.reasoning);

  // Spawn initial nodes (as roots)
  const { state: stateWithNodes, spawnedIds } = cortex.spawnNodes(
    state,
    startResult.nodesToSpawn.map(n => ({ ...n, parentId: null }))
  );
  state = stateWithNodes;
  state = addDecision(state, 'spawn', startResult.reasoning, spawnedIds, startResult.tokens);

  await emit(state);

  if (isAborted()) {
    return cortex.stopResearch(state);
  }

  // ──────────────────────────────────────────────────────────
  // 2. MAIN LOOP: Run nodes, process results
  // ──────────────────────────────────────────────────────────

  // Queue for completed nodes waiting to be processed
  const completionQueue: NodeCompleteEvent[] = [];
  const runningPromises = new Map<string, Promise<void>>();

  const startNode = async (nodeId: string) => {
    state = cortex.markNodeRunning(state, nodeId);
    await emit(state);

    const node = state.nodes[nodeId];
    onNodeStart?.(node);

    const context = buildNodeContext(state, nodeId);

    try {
      const result = await runNode(context, {
        signal,
        onSearch: async (search) => {
          // Update node's searches in state
          state = {
            ...state,
            nodes: {
              ...state.nodes,
              [nodeId]: {
                ...state.nodes[nodeId],
                searches: [...(state.nodes[nodeId].searches || []), search],
              },
            },
          };
          await emit(state);
        },
      });

      completionQueue.push({
        nodeId,
        answer: result.answer,
        confidence: result.confidence,
        suggestedFollowups: result.suggestedFollowups,
        searches: state.nodes[nodeId].searches || [],
        tokens: result.tokens,
      });
    } catch (error: any) {
      if (error.name === 'AbortError' || isAborted()) {
        return;
      }
      // Mark node as done with error
      completionQueue.push({
        nodeId,
        answer: `Error: ${error.message}`,
        confidence: 'low',
        suggestedFollowups: [],
        searches: state.nodes[nodeId].searches || [],
        tokens: 0,
      });
    }
  };

  // Main loop
  while (!isAborted()) {
    const counts = countByStatus(state);

    // Check if we're done (no more work)
    if (counts.pending === 0 && counts.running === 0 && completionQueue.length === 0) {
      break;
    }

    // Start pending nodes up to concurrency limit
    const pendingNodes = Object.values(state.nodes).filter(n => n.status === 'pending');
    const slotsAvailable = RESEARCH_LIMITS.maxConcurrentNodes - runningPromises.size;

    for (const node of pendingNodes.slice(0, slotsAvailable)) {
      const promise = startNode(node.id).finally(() => {
        runningPromises.delete(node.id);
      });
      runningPromises.set(node.id, promise);
    }

    // Wait for something to complete
    if (completionQueue.length === 0 && runningPromises.size > 0) {
      await Promise.race(runningPromises.values());
      continue;
    }

    // Process completed nodes
    while (completionQueue.length > 0 && !isAborted()) {
      const event = completionQueue.shift()!;

      // Mark node complete
      state = cortex.markNodeComplete(
        state,
        event.nodeId,
        event.answer,
        event.confidence,
        event.suggestedFollowups,
        event.searches,
        event.tokens
      );
      await emit(state);

      const completedNode = state.nodes[event.nodeId];
      onNodeComplete?.(completedNode);

      // ──────────────────────────────────────────────────────
      // 3. CORTEX DECIDES: What to do with this result?
      // ──────────────────────────────────────────────────────

      const decision = await cortex.processResult(state, completedNode);

      onDecision?.(decision.done ? 'done' : 'continue', decision.reasoning);

      // Apply finding updates
      if (decision.findingUpdates.length > 0) {
        state = cortex.applyFindingUpdates(state, decision.findingUpdates, event.nodeId);
      }

      // Collect all spawned node IDs
      const allSpawnedIds: string[] = [];

      // Spawn approved followups (as CHILDREN of completed node)
      if (decision.approvedFollowups.length > 0) {
        const { state: s, spawnedIds } = cortex.spawnNodes(
          state,
          decision.approvedFollowups.map(f => ({ ...f, parentId: completedNode.id }))
        );
        state = s;
        allSpawnedIds.push(...spawnedIds);
      }

      // Spawn new nodes (as ROOTS)
      if (decision.newNodes.length > 0) {
        const { state: s, spawnedIds } = cortex.spawnNodes(
          state,
          decision.newNodes.map(n => ({ ...n, parentId: null }))
        );
        state = s;
        allSpawnedIds.push(...spawnedIds);
      }

      // Record ONE decision with cortex reasoning
      if (allSpawnedIds.length > 0) {
        state = addDecision(state, 'spawn', decision.reasoning, allSpawnedIds, decision.tokens);
      } else {
        // No spawns, but still record the decision
        state = { ...state, totalTokens: (state.totalTokens || 0) + decision.tokens };
      }

      await emit(state);

      // Check if done
      if (decision.done) {
        // Wait for any running nodes to finish first
        if (runningPromises.size > 0) {
          await Promise.all(runningPromises.values());
          // Process any remaining completions without spawning more
          while (completionQueue.length > 0) {
            const e = completionQueue.shift()!;
            state = cortex.markNodeComplete(state, e.nodeId, e.answer, e.confidence, e.suggestedFollowups, e.searches, e.tokens);
            await emit(state);
          }
        }

        // ──────────────────────────────────────────────────────
        // 4. FINISH: Cortex writes final answer
        // ──────────────────────────────────────────────────────

        const finishResult = await cortex.finish(state);
        state = cortex.finishResearch(state, finishResult.finalAnswer);
        state = { ...state, totalTokens: (state.totalTokens || 0) + finishResult.tokens };
        state = addDecision(state, 'finish', 'Research complete', [], finishResult.tokens);
        await emit(state);

        return state;
      }

      // Safety: max nodes check
      if (Object.keys(state.nodes).length >= RESEARCH_LIMITS.maxNodes) {
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // 5. CLEANUP: Either aborted or hit limits
  // ──────────────────────────────────────────────────────────

  if (isAborted()) {
    state = cortex.stopResearch(state);
    await emit(state);
    return state;
  }

  // Finish even if we hit limits
  const finishResult = await cortex.finish(state);
  state = cortex.finishResearch(state, finishResult.finalAnswer);
  state = addDecision(state, 'finish', 'Research complete (limits reached)', [], finishResult.tokens);
  await emit(state);

  return state;
}

// ============================================================
// Helpers
// ============================================================

function addDecision(
  state: ResearchState,
  type: 'spawn' | 'complete' | 'finish',
  reasoning: string,
  nodeIds: string[],
  tokens: number
): ResearchState {
  return {
    ...state,
    decisions: [
      ...(state.decisions || []),
      { timestamp: Date.now(), type, reasoning, nodeIds, tokens },
    ],
  };
}
