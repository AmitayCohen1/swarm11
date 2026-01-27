/**
 * Cortex - Event-driven orchestration for tree-based research
 *
 * Key behaviors:
 * - Reacts when ANY node completes (no batch waiting)
 * - Can spawn children under any node, or new root-level nodes
 * - Sees all nodes' question + reason + finalDoc
 * - Sole authority to spawn/prune nodes
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  TreeResearchState,
  CortexView,
  ResearchNode,
  buildCortexView,
  createNode,
  countByStatus,
} from './tree-types';
import { trackLlmCall } from '@/lib/eval';

const model = openai('gpt-5.2');

// ============================================================
// Schemas
// ============================================================

const SpawnNodeSchema = z.object({
  question: z.string().max(100).describe('SHORT specific question (under 12 words). ONE focus only.'),
  reason: z.string().max(200).describe('Causal chain: "By learning X, we can Y → answers Z in objective"'),
  parentId: z.string().nullable().describe('ID of parent node, or null for root-level'),
});

const EvaluateSchema = z.object({
  reasoning: z.string().describe('Think through: what do we know, what gaps remain'),
  decision: z.enum(['spawn', 'done']).describe('spawn = need more research, done = have enough'),
  nodesToSpawn: z.array(SpawnNodeSchema).max(2).describe('New nodes to create (if decision=spawn)'),
});

const FinishSchema = z.object({
  answer: z.string().describe('Final comprehensive answer to the objective'),
});

// ============================================================
// Evaluate - Called when a node completes
// ============================================================

export interface CortexDecision {
  reasoning: string;
  decision: 'spawn' | 'done';
  nodesToSpawn: Array<{
    question: string;
    reason: string;
    parentId: string | null;
  }>;
}

export async function evaluate(
  state: TreeResearchState,
  completedNodeId?: string
): Promise<CortexDecision> {
  const view = buildCortexView(state);
  const counts = countByStatus(state);
  const completedNode = completedNodeId ? state.nodes[completedNodeId] : null;

  const prompt = buildEvaluatePrompt(view, completedNode, counts);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: EvaluateSchema }),
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;

  trackLlmCall({
    agentId: 'cortex_evaluate',
    model: 'gpt-5.2',
    systemPrompt: prompt,
    input: { objective: view.objective, nodeCount: view.nodes.length, completedNodeId },
    output: data,
  }).catch(() => {});

  return {
    reasoning: data.reasoning,
    decision: data.decision,
    nodesToSpawn: data.nodesToSpawn.map((n) => ({
      question: n.question,
      reason: n.reason,
      parentId: n.parentId,
    })),
  };
}

// ============================================================
// Finish - Synthesize final answer from all nodes
// ============================================================

export interface CortexFinishResult {
  answer: string;
}

export async function finish(state: TreeResearchState): Promise<CortexFinishResult> {
  const view = buildCortexView(state);
  const prompt = buildFinishPrompt(view);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;

  trackLlmCall({
    agentId: 'cortex_finish',
    model: 'gpt-5.2',
    systemPrompt: prompt,
    input: { objective: view.objective, nodeCount: view.nodes.length },
    output: data,
  }).catch(() => {});

  return { answer: data.answer };
}

// ============================================================
// Prompt Builders
// ============================================================

function buildEvaluatePrompt(
  view: CortexView,
  completedNode: ResearchNode | null,
  counts: Record<string, number>
): string {
  const nodesContext = view.nodes.length > 0
    ? view.nodes.map((n) => {
        const status = n.status === 'done' ? '✓' : n.status === 'running' ? '...' : '○';
        const parent = n.parentId ? ` (child of ${n.parentId})` : ' (root)';
        const doc = n.finalDoc ? `\n   Result: ${n.finalDoc}` : '';
        return `[${status}] ${n.id}${parent}\n   Q: ${n.question}\n   Why: ${n.reason}${doc}`;
      }).join('\n\n')
    : '(No nodes yet)';

  const suggestionsText = completedNode?.suggestedFollowups?.length
    ? `\n\nSUGGESTED FOLLOW-UPS (from the researcher - consider these but decide yourself):\n${completedNode.suggestedFollowups.map((s, i) => `  ${i + 1}. "${s.question}" - ${s.reason}`).join('\n')}`
    : '';

  const justCompleted = completedNode
    ? `\n\nJUST COMPLETED:\n- Node: ${completedNode.id}\n- Question: ${completedNode.question}\n- Result: ${completedNode.finalDoc}\n- Confidence: ${completedNode.confidence}${suggestionsText}`
    : '';

  return `You are the Cortex - the brain orchestrating a research tree.

OBJECTIVE: ${view.objective}
${Array.isArray(view.successCriteria) && view.successCriteria.length > 0 ? `SUCCESS CRITERIA:\n${view.successCriteria.map((c) => `- ${c}`).join('\n')}` : ''}

CURRENT TREE (${counts.done} done, ${counts.running} running, ${counts.pending} pending):
${nodesContext}
${justCompleted}

YOUR TASK:
1. Analyze what we know and what gaps remain
2. Decide: do we need more research (spawn) or have enough (done)?
3. If spawning, specify which nodes to create and where to attach them

THINK STRATEGICALLY:
Don't just map out a market - dig into what makes the research ACTIONABLE:
- Pain points: Who has the PROBLEM? Who's been burned?
- Buying signals: Who's already spending money on solutions?
- Urgency: What trends/events make this urgent NOW?
- Decision makers: Who actually buys, not just who uses?
- Proof points: What evidence shows the problem is real?

BAD research tree (just listing): "Top podcast networks" → "Top news orgs" → "Top radio groups"
GOOD research tree (actionable): "Recent misinformation lawsuits in media" → "Companies that settled" → "What they're spending on prevention"

QUESTION FORMAT:
- SHORT: Under 12 words. No compound questions.
- SPECIFIC: One clear thing to find out
- ACTIONABLE: Leads to insights you can ACT on, not just facts to know

REASON FORMAT:
The reason MUST be a clear causal chain: "By learning X, we can Y → answers Z in objective"

The reason must:
1. Start with what we'll LEARN from the answer
2. Explain what that ENABLES us to do
3. Connect to a SPECIFIC PART of the objective

RULES:
- Max 2 new nodes per decision
- Don't duplicate existing questions
- Attach children under a node to go deeper on that subtopic
- If all important gaps are filled, decide "done"

Think carefully, then respond.`;
}

function buildFinishPrompt(view: CortexView): string {
  const nodesContext = view.nodes
    .filter((n) => n.status === 'done' && n.finalDoc)
    .map((n) => {
      const parent = n.parentId ? ` (under ${n.parentId})` : '';
      return `### ${n.question}${parent}\n**Confidence:** ${n.confidence || 'unknown'}\n${n.finalDoc}`;
    })
    .join('\n\n---\n\n');

  return `You are synthesizing research findings into a final answer.

OBJECTIVE: ${view.objective}
${Array.isArray(view.successCriteria) && view.successCriteria.length > 0 ? `SUCCESS CRITERIA:\n${view.successCriteria.map((c) => `- ${c}`).join('\n')}` : ''}

COMPLETED RESEARCH:
${nodesContext}

Write a comprehensive, well-structured answer that:
1. Directly addresses the objective
2. Synthesizes findings from all research branches
3. Notes confidence levels where relevant
4. Is clear and actionable

Respond with your final answer.`;
}

// ============================================================
// State Mutations (pure functions that return new state)
// ============================================================

export function spawnNodes(
  state: TreeResearchState,
  nodes: Array<{ question: string; reason: string; parentId: string | null }>
): { state: TreeResearchState; spawnedIds: string[] } {
  const newState = { ...state, nodes: { ...state.nodes } };
  const spawnedIds: string[] = [];

  for (const n of nodes) {
    const node = createNode(n.question, n.reason, n.parentId);
    newState.nodes[node.id] = node;
    spawnedIds.push(node.id);

    // Log to cortex history
    newState.cortex.history = [
      ...(newState.cortex.history || []),
      { type: 'spawn' as const, nodeId: node.id, parentId: n.parentId, question: n.question, reason: n.reason },
    ];
  }

  return { state: newState, spawnedIds };
}

export function markNodeDone(
  state: TreeResearchState,
  nodeId: string,
  finalDoc: string,
  confidence: 'low' | 'medium' | 'high',
  searchHistory?: import('./tree-types').SearchEvent[],
  suggestedFollowups?: Array<{ question: string; reason: string }>
): TreeResearchState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...state.nodes[nodeId],
        status: 'done',
        completedAt: Date.now(),
        finalDoc,
        confidence,
        searchHistory: searchHistory || state.nodes[nodeId].searchHistory,
        suggestedFollowups: suggestedFollowups || [],
      },
    },
    cortex: {
      ...state.cortex,
      history: [...(state.cortex.history || []), { type: 'node_done' as const, nodeId }],
    },
  };
}

export function markNodeRunning(state: TreeResearchState, nodeId: string): TreeResearchState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...state.nodes[nodeId],
        status: 'running',
      },
    },
  };
}

export function finishResearch(state: TreeResearchState, finalAnswer: string): TreeResearchState {
  return {
    ...state,
    cortex: {
      ...state.cortex,
      status: 'done',
      finalAnswer,
    },
  };
}
