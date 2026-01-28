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
  Finding,
  FindingSource,
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

// Note: OpenAI strict JSON schema requires all fields to be required
const FindingSourceSchema = z.object({
  url: z.string().describe('Source URL (required)'),
  title: z.string().describe('Source title (use empty string if unknown)'),
});

const FindingUpdateSchema = z.object({
  action: z.enum(['add', 'update', 'remove']).describe('add = new finding, update = revise existing, remove = invalidated'),
  key: z.string().describe('Stable identifier for this finding (e.g., "top_candidates", "pricing_data", "disqualifiers")'),
  title: z.string().describe('Human-readable title (required for add/update, empty string for remove)'),
  content: z.string().describe('The finding content (required for add/update, empty string for remove)'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level'),
  sources: z.array(FindingSourceSchema).describe('Sources supporting this finding (can be empty array)'),
});

const EvaluateSchema = z.object({
  reasoning: z.string().describe('Think through: (1) What do we know? (2) Are success criteria addressed? (3) What gaps remain? (4) Is more research worth it?'),
  decision: z.enum(['spawn', 'done']).describe('spawn = critical gaps remain, done = have enough actionable info'),
  nodesToSpawn: z.array(SpawnNodeSchema).max(RESEARCH_LIMITS.maxNodesPerSpawn).describe('New nodes to create (if decision=spawn). Empty array if done.'),
  findingUpdates: z.array(FindingUpdateSchema).max(5).describe('Updates to the findings doc based on new research. Extract key insights, lists, evidence.'),
});

const FinishSchema = z.object({
  answer: z.string().describe('Final comprehensive answer to the objective'),
});

// ============================================================
// Types
// ============================================================

export interface FindingUpdate {
  action: 'add' | 'update' | 'remove';
  key: string;
  title?: string;
  content?: string;
  confidence?: 'low' | 'medium' | 'high';
  sources?: FindingSource[];
}

export interface CortexDecision {
  reasoning: string;
  decision: 'spawn' | 'done';
  nodesToSpawn: Array<{
    question: string;
    reason: string;
    parentId: string | null;
  }>;
  findingUpdates: FindingUpdate[];
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

  const prompt = buildEvaluatePrompt(view, completedNode, counts, state.findings || []);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: EvaluateSchema }),
    providerOptions: {
      openai: {
        reasoningEffort: 'low',
      },
    },
  });

  const data = result.output as z.infer<typeof EvaluateSchema>;
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 'cSZaU3rjiQxw', // Brain Evaluate (Observatory)
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
    findingUpdates: data.findingUpdates || [],
    tokens,
  };
}

// ============================================================
// Finish - Synthesize final answer
// ============================================================

export async function finish(state: ResearchState): Promise<CortexFinishResult> {
  const view = buildCortexView(state);
  const prompt = buildFinishPrompt(view, state.findings || []);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: FinishSchema }),
    providerOptions: {
      openai: {
        reasoningEffort: 'low',
      },
    },
  });

  const data = result.output as z.infer<typeof FinishSchema>;
  const tokens = result.usage?.totalTokens || 0;

  trackLlmCall({
    agentId: 'Uy4dSnQuHdzi', // Brain Finish (Observatory)
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
// Findings doc updater (pure)
// ============================================================

export function applyFindingUpdates(state: ResearchState, updates: FindingUpdate[]): ResearchState {
  if (!updates || updates.length === 0) return state;
  const existing = [...(state.findings || [])];
  const byKey = new Map(existing.map((f) => [f.key, f]));

  for (const u of updates) {
    const key = (u.key || '').trim();
    if (!key) continue;

    if (u.action === 'remove') {
      byKey.delete(key);
      continue;
    }

    // Filter out sources with empty URLs and map to FindingSource format
    const validSources = (u.sources || [])
      .filter((s) => s.url && s.url.trim())
      .map((s) => ({
        url: s.url,
        title: s.title || undefined,
      }));

    const next: Finding = {
      key,
      title: (u.title || '').trim() || key,
      content: u.content || '',
      confidence: u.confidence || 'medium',
      sources: validSources,
      updatedAt: Date.now(),
    };

    // add/update behave similarly: replace by key
    byKey.set(key, next);
  }

  // Preserve stable order: keep existing order, append new keys at end
  const remainingKeys = new Set(byKey.keys());
  const ordered: Finding[] = [];
  for (const f of existing) {
    const v = byKey.get(f.key);
    if (v) {
      ordered.push(v);
      remainingKeys.delete(f.key);
    }
  }
  for (const k of remainingKeys) {
    const v = byKey.get(k);
    if (v) ordered.push(v);
  }

  return { ...state, findings: ordered };
}

// ============================================================
// Prompt Builders
// ============================================================

function buildEvaluatePrompt(
  view: CortexView,
  completedNode: ResearchNode | null,
  counts: Record<string, number>,
  findings: Finding[]
): string {
  const tree = view.nodes.length
    ? view.nodes
        .map((n) => {
          const s = n.status === 'done' ? '✓' : n.status === 'running' ? '⟳' : '○';
          const p = n.parentId ? `→${n.parentId}` : '';
          return `${s} ${n.id}${p ? ` (${p})` : ''}: ${n.question}`;
        })
        .join('\n')
    : '(no nodes)';

  const findingsDoc = findings.length
    ? findings
        .slice(0, 20)
        .map((f) => `- [${f.key}] ${f.title} (${f.confidence}) — ${f.content}`)
        .join('\n')
    : '(empty)';

  const completedBlock = completedNode
    ? `\nLATEST RESULT:\n- nodeId: ${completedNode.id}\n- question: ${completedNode.question}\n- confidence: ${completedNode.confidence}\n- answer: ${completedNode.answer}`
    : '';

  const constraints = Array.isArray(view.successCriteria) && view.successCriteria.length > 0
    ? view.successCriteria.map((c) => `- ${c}`).join('\n')
    : '(none)';

  return `You're orchestrating research like a resourceful investigator, not a search engine.

OBJECTIVE: ${view.objective}

SUCCESS CRITERIA:
${constraints}

FINDINGS SO FAR:
${findingsDoc}

TREE (${counts.done} done / ${counts.running} running / ${counts.pending} pending):
${tree}${completedBlock}

HOW TO THINK:
- Form hypotheses, not queries. "Maybe industry events list key players" beats "how to find decision makers"
- Chase signals of quality. Job titles lie. Look for where good people actually show up.
- Cross-reference and filter. Found 50 names? Great - now find which ones are actually relevant.
- Look for timing signals. Recent job changes, funding announcements, layoffs = opportunities.
- Dead ends are data. If something didn't work, that tells you where to pivot.
- Stop when actionable. One great lead beats 50 maybes. Don't "cover everything."

QUESTION QUALITY:
- BAD: "How to find podcast executives?" (generic, no hypothesis)
- BAD: "Contact details for media companies?" (too broad, no signal)
- GOOD: "Which podcast networks focus on news/journalism content?" (specific, filterable)
- GOOD: "What media companies announced audio initiatives recently?" (timing signal)
- GOOD: "Who spoke at Podcast Movement 2024 about fact-checking?" (signal over credentials)

RULES:
- Respect user constraints exactly. Don't broaden scope.
- Each node runs web searches - you orchestrate strategy, not queries.
- If a question exists in the tree, don't repeat it.
- Go deeper on promising threads. Let cold branches die.
- If findings are actionable, say "done". Don't over-research.

FINDING UPDATES:
- Output 0–5 findingUpdates with stable snake_case keys.
- For action="remove", use empty strings for title/content and [] for sources.

Respond with JSON matching the schema.`;
}

function buildFinishPrompt(view: CortexView, findings: Finding[]): string {
  const findingsText = findings.length > 0
    ? findings
        .map((f) => {
          const src = (f.sources || []).slice(0, 5).map((s) => `- ${s.title || s.url} (${s.url})`).join('\n');
          const srcBlock = src ? `\n\nSources:\n${src}` : '';
          return `### ${f.title}\n**Key:** ${f.key}\n**Confidence:** ${f.confidence}\n${f.content}${srcBlock}`;
        })
        .join('\n\n---\n\n')
    : '(No findings doc yet. If needed, use completed research below.)';

  const fallbackNodesContext = view.nodes
    .filter((n) => n.status === 'done' && n.answer)
    .slice(0, 10)
    .map((n) => `- ${n.question} (${n.confidence || 'unknown'}): ${String(n.answer).substring(0, 240)}${String(n.answer).length > 240 ? '…' : ''}`)
    .join('\n');

  return `You are synthesizing research findings into a final answer.

OBJECTIVE: ${view.objective}
${Array.isArray(view.successCriteria) && view.successCriteria.length > 0 ? `SUCCESS CRITERIA:\n${view.successCriteria.map((c) => `- ${c}`).join('\n')}` : ''}

FINDINGS DOC (PRIMARY SOURCE OF TRUTH):
${findingsText}

COMPLETED RESEARCH (fallback summaries):
${fallbackNodesContext || '(none)'}

Write a comprehensive, well-structured answer that:
1. Directly addresses the objective
2. Synthesizes from the Findings Doc (and uses fallback only if needed)
3. Notes confidence levels where relevant
4. Is clear and actionable

Respond with your final answer.`;
}
