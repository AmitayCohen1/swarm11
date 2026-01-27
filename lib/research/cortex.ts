/**
 * Cortex - The brain that orchestrates research
 *
 * Responsibilities:
 * - Decide what questions to research (spawn nodes)
 * - Decide when we have enough information (done)
 * - Synthesize the final answer
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  ResearchState,
  ResearchNode,
  CortexView,
  Followup,
  buildCortexView,
  createNode,
  countByStatus,
  RESEARCH_MODEL,
  RESEARCH_LIMITS,
} from './types';
import { trackLlmCall } from '@/lib/eval';

const model = openai(RESEARCH_MODEL);

// ============================================================
// Schemas
// ============================================================

const SpawnNodeSchema = z.object({
  question: z.string().max(100).describe('SHORT specific question (under 12 words). ONE focus only.'),
  reason: z.string().max(300).describe('Start with "I\'m asking this because..." - explain WHY this matters, WHAT insight we\'ll gain, and HOW it helps achieve the main objective. Be conversational, not robotic.'),
  parentId: z.string().nullable().describe('ID of parent node, or null for root-level'),
});

const EvaluateSchema = z.object({
  reasoning: z.string().describe('Think through: (1) What do we know? (2) Are success criteria addressed? (3) What gaps remain? (4) Is more research worth it?'),
  decision: z.enum(['spawn', 'done']).describe('spawn = critical gaps remain, done = have enough actionable info'),
  nodesToSpawn: z.array(SpawnNodeSchema).max(RESEARCH_LIMITS.maxNodesPerSpawn).describe('New nodes to create (if decision=spawn). Empty array if done.'),
});

const FinishSchema = z.object({
  answer: z.string().describe('Final comprehensive answer to the objective'),
});

// ============================================================
// Types
// ============================================================

export interface CortexDecision {
  reasoning: string;
  decision: 'spawn' | 'done';
  nodesToSpawn: Array<{
    question: string;
    reason: string;
    parentId: string | null;
  }>;
  tokens: number;
}

export interface CortexFinishResult {
  answer: string;
  tokens: number;
}

// ============================================================
// Evaluate - Decide what to do next
// ============================================================

export async function evaluate(
  state: ResearchState,
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
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 'cortex_evaluate',
    model: RESEARCH_MODEL,
    systemPrompt: prompt,
    input: { objective: view.objective, nodeCount: view.nodes.length, completedNodeId },
    output: data,
    tokenCount: tokens,
  }).catch(() => {});

  return {
    reasoning: data.reasoning,
    decision: data.decision,
    nodesToSpawn: data.nodesToSpawn.map((n) => ({
      question: n.question,
      reason: n.reason,
      parentId: n.parentId,
    })),
    tokens,
  };
}

// ============================================================
// Finish - Synthesize final answer
// ============================================================

export async function finish(state: ResearchState): Promise<CortexFinishResult> {
  const view = buildCortexView(state);
  const prompt = buildFinishPrompt(view);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: FinishSchema }),
  });

  const data = result.output as z.infer<typeof FinishSchema>;
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 'cortex_finish',
    model: RESEARCH_MODEL,
    systemPrompt: prompt,
    input: { objective: view.objective, nodeCount: view.nodes.length },
    output: data,
    tokenCount: tokens,
  }).catch(() => {});

  return { answer: data.answer, tokens };
}

// ============================================================
// State Mutations (pure functions)
// ============================================================

export function spawnNodes(
  state: ResearchState,
  nodes: Array<{ question: string; reason: string; parentId: string | null }>
): { state: ResearchState; spawnedIds: string[] } {
  const newState = { ...state, nodes: { ...state.nodes }, decisions: [...(state.decisions || [])] };
  const spawnedIds: string[] = [];

  for (const n of nodes) {
    const node = createNode(n.question, n.reason, n.parentId);
    newState.nodes[node.id] = node;
    spawnedIds.push(node.id);
  }

  newState.decisions.push({
    timestamp: Date.now(),
    type: 'spawn',
    reasoning: `Spawned ${nodes.length} nodes`,
    nodeIds: spawnedIds,
  });

  return { state: newState, spawnedIds };
}

export function markNodeRunning(state: ResearchState, nodeId: string): ResearchState {
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

export function markNodeDone(
  state: ResearchState,
  nodeId: string,
  answer: string,
  confidence: 'low' | 'medium' | 'high',
  searches?: ResearchState['nodes'][string]['searches'],
  suggestedFollowups?: Followup[],
  tokens?: number
): ResearchState {
  return {
    ...state,
    totalTokens: (state.totalTokens || 0) + (tokens || 0),
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...state.nodes[nodeId],
        status: 'done',
        completedAt: Date.now(),
        answer,
        confidence,
        searches: searches || state.nodes[nodeId].searches,
        suggestedFollowups: suggestedFollowups || [],
        tokens,
      },
    },
  };
}

export function finishResearch(state: ResearchState, finalAnswer: string): ResearchState {
  return {
    ...state,
    status: 'complete',
    finalAnswer,
    decisions: [
      ...(state.decisions || []),
      { timestamp: Date.now(), type: 'finish', reasoning: 'Research complete' },
    ],
  };
}

export function stopResearch(state: ResearchState): ResearchState {
  return {
    ...state,
    status: 'stopped',
    finalAnswer: 'Research was stopped by user.',
  };
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
        const doc = n.answer ? `\n   Result: ${n.answer}` : '';
        return `[${status}] ${n.id}${parent}\n   Q: ${n.question}\n   Why: ${n.reason}${doc}`;
      }).join('\n\n')
    : '(No nodes yet)';

  const suggestionsText = completedNode?.suggestedFollowups?.length
    ? `\n\nSUGGESTED FOLLOW-UPS (from the researcher - consider these but decide yourself):\n${completedNode.suggestedFollowups.map((s, i) => `  ${i + 1}. "${s.question}" - ${s.reason}`).join('\n')}`
    : '';

  const justCompleted = completedNode
    ? `\n\nJUST COMPLETED:\n- Node: ${completedNode.id}\n- Question: ${completedNode.question}\n- Result: ${completedNode.answer}\n- Confidence: ${completedNode.confidence}${suggestionsText}`
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

WHEN TO DECIDE "DONE" (finish research):
${Array.isArray(view.successCriteria) && view.successCriteria.length > 0
  ? `✓ All success criteria are addressed with confident answers:
${view.successCriteria.map((c) => `  - "${c}"`).join('\n')}`
  : `✓ The objective can be answered with actionable, specific information`}
✓ We have ENOUGH info to give a useful answer (not perfect, but actionable)
✓ Additional research would only add marginal value
✓ Key questions have medium or high confidence answers
${counts.running > 0 ? `\nNOTE: ${counts.running} node(s) still running - their results will be included in final synthesis. Consider if you need MORE beyond those.` : ''}

WHEN TO SPAWN MORE:
✗ Critical gaps remain that would make the answer incomplete
✗ Success criteria are not yet addressed
✗ We only have surface-level info, need to dig deeper
✗ Low confidence on important questions

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

REASON FORMAT (CRITICAL - write like explaining to someone):
Pattern: "I'm asking this because [WHY THIS MATTERS]. This will help us [CONCRETE BENEFIT] which is essential for achieving our main goal: [REFERENCE OBJECTIVE]."

GOOD reasons (conversational, clear connection):
- "I'm asking this because knowing which companies got sued reveals who's desperate for solutions. This will help us find buyers with urgent pain, which is essential for finding real market demand."
- "I'm asking this because pricing data tells us what the market will bear. This will help us position competitively, which is essential for our go-to-market strategy."

BAD reasons (robotic, vague):
- "By learning X, we can Y → directly answers Z" ❌ (too mechanical)
- "This covers the entertainment aspect" ❌ (vague)
- "Useful for understanding the market" ❌ (no clear connection)

The reason MUST:
1. Start with "I'm asking this because..." (human, conversational)
2. Explain the INSIGHT we'll gain (not just what we'll learn)
3. Connect to HOW it helps achieve: "${view.objective}"

RULES:
- Max ${RESEARCH_LIMITS.maxNodesPerSpawn} new nodes per decision
- Don't duplicate existing questions
- Attach children under a node to go deeper on that subtopic
- If all important gaps are filled, decide "done"

Think carefully, then respond.`;
}

function buildFinishPrompt(view: CortexView): string {
  const nodesContext = view.nodes
    .filter((n) => n.status === 'done' && n.answer)
    .map((n) => {
      const parent = n.parentId ? ` (under ${n.parentId})` : '';
      return `### ${n.question}${parent}\n**Confidence:** ${n.confidence || 'unknown'}\n${n.answer}`;
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
