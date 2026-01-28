/**
 * Research Types - Single source of truth for both backend and frontend
 */

// ============================================================
// Configuration
// ============================================================

export const RESEARCH_MODEL = process.env.RESEARCH_MODEL || 'gpt-4o';

export const RESEARCH_LIMITS = {
  maxNodes: 20,
  maxDepth: 4,
  maxTimeMs: 10 * 60 * 1000, // 10 minutes
  maxConcurrentNodes: 3,
  minSearchesPerNode: 3,
  maxSearchesPerNode: 10,
  maxFollowupsPerNode: 2,
  maxNodesPerSpawn: 2,
};

// ============================================================
// Core Types
// ============================================================

export type NodeStatus = 'pending' | 'running' | 'done' | 'pruned';
export type Confidence = 'low' | 'medium' | 'high';
export type ResearchStatus = 'running' | 'complete' | 'stopped';

/**
 * A single research node in the tree
 */
export interface ResearchNode {
  id: string;
  parentId: string | null;

  // What this node is researching
  question: string;
  reason: string; // Why this question helps answer the objective

  // Status
  status: NodeStatus;
  createdAt: number;
  completedAt?: number;

  // Results (populated when done)
  answer?: string;
  confidence?: Confidence;
  suggestedFollowups?: Followup[];

  // Tree control knobs
  priority?: number; // 1 (cold) → 5 (hot)
  prunedReason?: string;

  // Search history (for UI display)
  searches?: SearchEntry[];

  // Token usage for this node
  tokens?: number;
}

export interface Followup {
  question: string;
  reason: string;
}

export interface SearchEntry {
  query: string;
  result: string;
  sources?: Source[];
  reflection?: string;
  timestamp: number;
}

export interface Source {
  url: string;
  title?: string;
}

// ============================================================
// Findings Doc (incremental synthesis)
// ============================================================

export interface FindingSource {
  url: string;
  title?: string;
  nodeId?: string;
  query?: string;
}

export interface Finding {
  key: string; // stable identifier, e.g. "top_candidates" / "pricing_evidence"
  title: string;
  content: string;
  confidence: Confidence;
  sources: FindingSource[];
  updatedAt: number;
}

// ============================================================
// Research State (stored in DB, used everywhere)
// ============================================================

/**
 * Complete research state - this is what gets stored in the DB
 * and sent to the frontend.
 */
export interface ResearchState {
  // The research objective
  objective: string;
  successCriteria?: string[];

  // Current status
  status: ResearchStatus;

  // All nodes in the tree (flat map for easy lookup)
  nodes: Record<string, ResearchNode>;

  // Incremental synthesis document (curated findings + sources)
  findings?: Finding[];

  // Final synthesized answer (when complete)
  finalAnswer?: string;

  // Decision history (for debugging/transparency)
  decisions?: Decision[];

  // Token usage tracking
  totalTokens?: number;
}

export interface Decision {
  timestamp: number;
  type: 'spawn' | 'complete' | 'finish';
  reasoning: string;
  nodeIds?: string[]; // Which nodes were spawned
  tokens?: number; // Tokens used for this decision
}

// ============================================================
// Context Types (internal use during research)
// ============================================================

/**
 * What a node sees when doing its research
 */
export interface NodeContext {
  objective: string;
  lineage: LineageEntry[]; // Ancestor chain from root to parent
  task: {
    question: string;
    reason: string;
  };
}

export interface LineageEntry {
  question: string;
  reason: string;
  answer?: string;
}

/**
 * What the cortex sees when making decisions
 */
export interface CortexView {
  objective: string;
  successCriteria?: string[];
  findings: Finding[];
  nodes: Array<{
    id: string;
    parentId: string | null;
    question: string;
    reason: string;
    status: NodeStatus;
    answer?: string;
    confidence?: Confidence;
    suggestedFollowups?: Followup[];
  }>;
}

// ============================================================
// Helpers
// ============================================================

export function generateId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialState(
  objective: string,
  successCriteria?: string[]
): ResearchState {
  return {
    objective,
    successCriteria,
    status: 'running',
    nodes: {},
    findings: [],
    decisions: [],
  };
}

export function createNode(
  question: string,
  reason: string,
  parentId: string | null = null,
  priority: number = 3
): ResearchNode {
  return {
    id: generateId(),
    parentId,
    question,
    reason,
    status: 'pending',
    createdAt: Date.now(),
    priority,
  };
}

/**
 * Build the context a node needs to do its research
 */
export function buildNodeContext(
  state: ResearchState,
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
      answer: ancestor.answer,
    });
    currentId = ancestor.parentId;
  }

  return {
    objective: state.objective,
    lineage,
    task: {
      question: node.question,
      reason: node.reason,
    },
  };
}

/**
 * Build the view the cortex needs to make decisions
 */
export function buildCortexView(state: ResearchState): CortexView {
  return {
    objective: state.objective,
    successCriteria: state.successCriteria,
    findings: state.findings || [],
    nodes: Object.values(state.nodes).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      question: n.question,
      reason: n.reason,
      status: n.status,
      answer: n.answer,
      confidence: n.confidence,
      suggestedFollowups: n.suggestedFollowups,
    })),
  };
}

/**
 * Count nodes by status
 */
export function countByStatus(state: ResearchState): Record<NodeStatus, number> {
  const counts: Record<NodeStatus, number> = { pending: 0, running: 0, done: 0, pruned: 0 };
  for (const node of Object.values(state.nodes)) {
    counts[node.status]++;
  }
  return counts;
}

/**
 * Get depth of a node in the tree
 */
export function getNodeDepth(state: ResearchState, nodeId: string): number {
  let depth = 0;
  let current = state.nodes[nodeId];
  while (current?.parentId) {
    depth++;
    current = state.nodes[current.parentId];
  }
  return depth;
}
