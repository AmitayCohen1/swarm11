/**
 * Cortex - The Research Brain
 *
 * Simple API:
 * - start(objective) → initial nodes to spawn
 * - processResult(node) → findings updates, approved followups, done?
 * - finish(findings) → final answer
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  ResearchState,
  ResearchNode,
  Finding,
  Followup,
  Confidence,
  createNode,
  createInitialState,
  buildCortexView,
  countByStatus,
  RESEARCH_LIMITS,
  RESEARCH_MODEL,
} from './types';

const model = openai(RESEARCH_MODEL);

// ============================================================
// Types
// ============================================================

export interface StartResult {
  state: ResearchState;
  nodesToSpawn: Array<{ question: string; reason: string }>;
  reasoning: string;
  tokens: number;
}

export interface ProcessResult {
  findingUpdates: FindingUpdate[];
  approvedFollowups: Array<{ question: string; reason: string }>;
  newNodes: Array<{ question: string; reason: string }>;
  done: boolean;
  reasoning: string;
  tokens: number;
}

export interface FindingUpdate {
  action: 'add' | 'update' | 'remove';
  key: string;
  title: string;
  content: string;
  confidence: Confidence;
  sources: Array<{ url: string; title: string }>;
}

export interface FinishResult {
  finalAnswer: string;
  tokens: number;
}

// ============================================================
// Schemas
// ============================================================

const StartSchema = z.object({
  reasoning: z.string().describe("Brief explanation of your research strategy"),
  nodes: z.array(z.object({
    question: z.string().max(100).describe("Short specific question (under 12 words)"),
    reason: z.string().max(200).describe("Why this helps answer the objective"),
  })).max(RESEARCH_LIMITS.maxNodesPerSpawn),
});

const ProcessSchema = z.object({
  reasoning: z.string().describe("Brief explanation of your decision"),

  findingUpdates: z.array(z.object({
    action: z.enum(['add', 'update', 'remove']),
    key: z.string().describe("Stable key like 'pricing_data' or 'top_candidates'"),
    title: z.string().describe("Human readable title"),
    content: z.string().describe("The finding content"),
    confidence: z.enum(['low', 'medium', 'high']),
    sources: z.array(z.object({
      url: z.string(),
      title: z.string(),
    })),
  })).describe("Updates to the findings doc based on this node's results"),

  approvedFollowups: z.array(z.object({
    question: z.string(),
    reason: z.string(),
  })).describe("Which of the node's suggested followups to pursue"),

  newNodes: z.array(z.object({
    question: z.string(),
    reason: z.string(),
  })).describe("New research directions (not followups)"),

  done: z.boolean().describe("True if we have enough to answer the objective"),
});

const FinishSchema = z.object({
  answer: z.string().describe("The final comprehensive answer"),
});

// ============================================================
// API
// ============================================================

/**
 * Start research - returns initial nodes to spawn
 */
export async function start(
  objective: string,
  successCriteria?: string[]
): Promise<StartResult> {
  const prompt = buildStartPrompt(objective, successCriteria);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: StartSchema }),
  });

  const tokens = result.usage?.totalTokens || 0;
  const data = result.output as z.infer<typeof StartSchema>;
  const state = createInitialState(objective, successCriteria);

  return {
    state,
    nodesToSpawn: data.nodes,
    reasoning: data.reasoning,
    tokens,
  };
}

/**
 * Process a completed node - decide what to do next
 */
export async function processResult(
  state: ResearchState,
  completedNode: ResearchNode
): Promise<ProcessResult> {
  const prompt = buildProcessPrompt(state, completedNode);

  const result = await generateText({
    model,
    prompt,
   
    output: Output.object({ schema: ProcessSchema }),
  });

  const tokens = result.usage?.totalTokens || 0;
  const data = result.output as z.infer<typeof ProcessSchema>;

  return {
    findingUpdates: data.findingUpdates as FindingUpdate[],
    approvedFollowups: data.approvedFollowups,
    newNodes: data.newNodes,
    done: data.done,
    reasoning: data.reasoning,
    tokens,
  };
}

/**
 * Finish research - write final answer from findings
 */
export async function finish(
  state: ResearchState
): Promise<FinishResult> {
  const prompt = buildFinishPrompt(state);

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: FinishSchema }),
  });

  const tokens = result.usage?.totalTokens || 0;
  const data = result.output as z.infer<typeof FinishSchema>;

  return {
    finalAnswer: data.answer,
    tokens,
  };
}

// ============================================================
// State Mutations
// ============================================================

/**
 * Apply finding updates to state
 */
export function applyFindingUpdates(
  state: ResearchState,
  updates: FindingUpdate[],
  sourceNodeId: string
): ResearchState {
  const findings = [...(state.findings || [])];

  for (const update of updates) {
    const idx = findings.findIndex(f => f.key === update.key);

    if (update.action === 'remove') {
      if (idx >= 0) findings.splice(idx, 1);
    } else if (update.action === 'add' || update.action === 'update') {
      const finding: Finding = {
        key: update.key,
        title: update.title,
        content: update.content,
        confidence: update.confidence,
        sources: update.sources.map(s => ({
          ...s,
          nodeId: sourceNodeId,
        })),
        updatedAt: Date.now(),
      };

      if (idx >= 0) {
        findings[idx] = finding;
      } else {
        findings.push(finding);
      }
    }
  }

  return { ...state, findings };
}

/**
 * Spawn nodes and add to state
 */
export function spawnNodes(
  state: ResearchState,
  nodes: Array<{ question: string; reason: string; parentId?: string | null }>
): { state: ResearchState; spawnedIds: string[] } {
  const newState = { ...state, nodes: { ...state.nodes } };
  const spawnedIds: string[] = [];

  for (const n of nodes) {
    const node = createNode(n.question, n.reason, n.parentId ?? null);
    newState.nodes[node.id] = node;
    spawnedIds.push(node.id);
  }

  return { state: newState, spawnedIds };
}

/**
 * Mark node as running
 */
export function markNodeRunning(state: ResearchState, nodeId: string): ResearchState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: { ...state.nodes[nodeId], status: 'running' },
    },
  };
}

/**
 * Mark node as complete with results
 */
export function markNodeComplete(
  state: ResearchState,
  nodeId: string,
  answer: string,
  confidence: Confidence,
  suggestedFollowups: Followup[],
  searches: any[],
  tokens: number
): ResearchState {
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...state.nodes[nodeId],
        status: 'done',
        completedAt: Date.now(),
        answer,
        confidence,
        suggestedFollowups,
        searches,
        tokens,
      },
    },
    totalTokens: (state.totalTokens || 0) + tokens,
  };
}

/**
 * Mark research as complete
 */
export function finishResearch(state: ResearchState, finalAnswer: string): ResearchState {
  return {
    ...state,
    status: 'complete',
    finalAnswer,
  };
}

/**
 * Mark research as stopped
 */
export function stopResearch(state: ResearchState): ResearchState {
  return {
    ...state,
    status: 'stopped',
  };
}

// ============================================================
// Prompts
// ============================================================

function buildStartPrompt(objective: string, successCriteria?: string[]): string {
  const criteria = successCriteria?.length
    ? successCriteria.join('; ')
    : '(none specified)';

  return `You are beginning a new research task.

OBJECTIVE: ${objective}
SUCCESS CRITERIA: ${criteria}

Think about this like a curious, thoughtful researcher.

Before trying to solve anything, we need to get our bearings.

Propose ${RESEARCH_LIMITS.maxNodesPerSpawn} starting questions that would help us understand this space better.

Good starting questions:
- Help us see what’s going on in this world
- Reveal how things currently work
- Point toward where interesting activity or tension exists

We’re not looking for perfect questions.
We’re looking for good places to start exploring.`;
}


function buildProcessPrompt(state: ResearchState, completedNode: ResearchNode): string {
  const view = buildCortexView(state);
  const counts = countByStatus(state);

  const findingsText = (state.findings || []).length
    ? state.findings!.map(f => `- ${f.key}: ${f.content.substring(0, 200)}... (${f.confidence})`).join('\n')
    : '(none yet)';

  const suggestedFollowupsText = completedNode.suggestedFollowups?.length
    ? completedNode.suggestedFollowups.map(f => `- "${f.question}" - ${f.reason}`).join('\n')
    : '(none suggested)';

  const otherNodesText = view.nodes
    .filter(n => n.id !== completedNode.id)
    .slice(0, 10)
    .map(n => `- [${n.status}] "${n.question}"${n.answer ? ` → ${n.answer.substring(0, 100)}...` : ''}`)
    .join('\n') || '(none)';

  return `You’re in the middle of a research session. One question just finished.

OBJECTIVE: ${state.objective}
SUCCESS CRITERIA: ${state.successCriteria?.join('; ') || '(none)'}

WHAT WE KNOW SO FAR:
${findingsText}

COMPLETED QUESTION:
"${completedNode.question}"

ANSWER:
${completedNode.answer?.substring(0, 500) || '(no answer)'}

Confidence: ${completedNode.confidence || 'unknown'}

SUGGESTED FOLLOWUPS FROM THIS NODE:
${suggestedFollowupsText}

OTHER QUESTIONS IN PLAY (${counts.done} done, ${counts.running} running, ${counts.pending} pending):
${otherNodesText}

LIMITS:
Max ${RESEARCH_LIMITS.maxNodes} total nodes.
Currently have ${Object.keys(state.nodes).length} nodes.

Take a moment and think:

- What feels important about what we just learned?
- Did anything stand out or spark curiosity?
- What would be a natural next thing to look into?
- Should we double down somewhere, or shift direction slightly?

Decide:

1. Any findings to add, update, or remove.
2. Which followups (if any) are worth pursuing.
3. Any new questions that now feel worth asking.
4. Whether we’re starting to have enough understanding to address the objective.

Let the research evolve organically based on what we’re discovering.`;
}


function buildFinishPrompt(state: ResearchState): string {
  const findingsText = (state.findings || []).length
    ? state.findings!.map(f => `## ${f.title}\n${f.content}\n(Confidence: ${f.confidence})`).join('\n\n')
    : '(no findings)';

  const nodeAnswersText = Object.values(state.nodes)
    .filter(n => n.status === 'done' && n.answer)
    .slice(0, 10)
    .map(n => `Q: ${n.question}\nA: ${n.answer!.substring(0, 300)}...`)
    .join('\n\n');

  return `Write the final answer for this research.

OBJECTIVE: ${state.objective}
SUCCESS CRITERIA: ${state.successCriteria?.join('; ') || '(none)'}

CURATED FINDINGS (primary source):
${findingsText}

NODE ANSWERS (backup context):
${nodeAnswersText}

Write a clear, comprehensive, actionable answer. Be specific with facts, names, numbers.
Don't add meta-commentary like "based on my research" - just give the answer.`;
}
