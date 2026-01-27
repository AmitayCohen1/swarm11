/**
 * Tree-Based Research Architecture Types
 *
 * Memory model:
 * - Cortex sees: every node's question, reason, finalDoc
 * - Each node sees: full lineage chain (question + reason + finalDoc) up to root
 */

// ============================================================
// Research Node
// ============================================================

export type NodeStatus = 'pending' | 'running' | 'done';

export interface ResearchNode {
  id: string;
  parentId: string | null;

  // The task
  question: string;
  reason: string; // Why cortex spawned this

  // Status
  status: NodeStatus;
  createdAt: number;
  completedAt?: number;

  // Result (when done)
  finalDoc?: string;
  confidence?: 'low' | 'medium' | 'high';
  suggestedFollowups?: SuggestedFollowup[];

  // Internal work log (for debugging/UI, not sent to other nodes)
  searchHistory?: SearchEvent[];
}

export interface SuggestedFollowup {
  question: string;
  reason: string;
}

export type SearchEvent =
  | {
      type: 'search';
      query: string;
      answer: string;
      sources?: Array<{ title: string; url: string }>;
      timestamp: number;
    }
  | {
      type: 'reflect';
      thought: string;
      timestamp: number;
    };

// ============================================================
// Cortex State
// ============================================================

export interface CortexState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'done';
  finalAnswer?: string;
  history?: CortexEvent[];
}

export type CortexEvent =
  | { type: 'spawn'; nodeId: string; parentId: string | null; question: string; reason: string }
  | { type: 'node_done'; nodeId: string }
  | { type: 'decide'; reasoning: string; action: string };

// ============================================================
// Full State (stored as one JSON blob)
// ============================================================

export interface TreeResearchState {
  cortex: CortexState;
  nodes: Record<string, ResearchNode>;
}

// ============================================================
// Lineage Context (what a node receives)
// ============================================================

export interface LineageEntry {
  question: string;
  reason: string;
  finalDoc?: string;
}

export interface NodeContext {
  objective: string;
  lineage: LineageEntry[]; // From root down to parent
  task: {
    question: string;
    reason: string;
  };
}

// ============================================================
// Cortex View (what cortex sees when deciding)
// ============================================================

export interface CortexView {
  objective: string;
  successCriteria?: string[];
  nodes: Array<{
    id: string;
    parentId: string | null;
    question: string;
    reason: string;
    status: NodeStatus;
    finalDoc?: string;
    confidence?: 'low' | 'medium' | 'high';
  }>;
}

// ============================================================
// Helpers
// ============================================================

export function generateNodeId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function createTreeResearchState(
  objective: string,
  successCriteria?: string[]
): TreeResearchState {
  return {
    cortex: {
      objective,
      successCriteria,
      status: 'running',
      history: [],
    },
    nodes: {},
  };
}

export function createNode(
  question: string,
  reason: string,
  parentId: string | null = null
): ResearchNode {
  return {
    id: generateNodeId(),
    parentId,
    question,
    reason,
    status: 'pending',
    createdAt: Date.now(),
  };
}

/**
 * Build lineage context for a node (what it needs to do its work)
 */
export function buildNodeContext(
  state: TreeResearchState,
  nodeId: string
): NodeContext {
  const node = state.nodes[nodeId];
  const lineage: LineageEntry[] = [];

  // Walk up the tree from parent to root
  let currentId = node.parentId;
  while (currentId) {
    const ancestor = state.nodes[currentId];
    lineage.unshift({
      question: ancestor.question,
      reason: ancestor.reason,
      finalDoc: ancestor.finalDoc,
    });
    currentId = ancestor.parentId;
  }

  return {
    objective: state.cortex.objective,
    lineage,
    task: {
      question: node.question,
      reason: node.reason,
    },
  };
}

/**
 * Build cortex view (what cortex needs to make decisions)
 */
export function buildCortexView(state: TreeResearchState): CortexView {
  return {
    objective: state.cortex.objective,
    successCriteria: state.cortex.successCriteria,
    nodes: Object.values(state.nodes).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      question: n.question,
      reason: n.reason,
      status: n.status,
      finalDoc: n.finalDoc,
      confidence: n.confidence,
    })),
  };
}

/**
 * Get children of a node
 */
export function getChildren(
  state: TreeResearchState,
  nodeId: string
): ResearchNode[] {
  return Object.values(state.nodes).filter((n) => n.parentId === nodeId);
}

/**
 * Get root nodes (no parent)
 */
export function getRootNodes(state: TreeResearchState): ResearchNode[] {
  return Object.values(state.nodes).filter((n) => n.parentId === null);
}

/**
 * Count nodes by status
 */
export function countByStatus(state: TreeResearchState): Record<NodeStatus, number> {
  const counts: Record<NodeStatus, number> = { pending: 0, running: 0, done: 0 };
  for (const node of Object.values(state.nodes)) {
    counts[node.status]++;
  }
  return counts;
}
