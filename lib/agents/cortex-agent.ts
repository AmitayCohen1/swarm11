/**
 * Cortex Agent
 *
 * The orchestrating intelligence that:
 * 1. Generates diverse initiatives from the objective
 * 2. Evaluates initiative results
 * 3. Decides next actions (drill down, spawn new, synthesize)
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { CortexDoc, Initiative } from '@/lib/types/initiative-doc';
import {
  addInitiative,
  addCortexDecision,
  setDocStatus,
  setFinalAnswer,
  formatCortexDocForAgent,
  getInitiativesSummary,
  getAllActiveFindings,
  getCompletedInitiatives,
  getRunningInitiatives,
  getPendingInitiatives,
} from '@/lib/utils/initiative-operations';

// Logging helper
const log = (fn: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `[CortexAgent ${timestamp}] [${fn}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
};

interface CortexAgentConfig {
  doc: CortexDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

// ============================================================
// Initiative Generation
// ============================================================

interface GenerateInitiativesConfig {
  doc: CortexDoc;
  count?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface GenerateInitiativesResult {
  doc: CortexDoc;
  initiativeIds: string[];
  creditsUsed: number;
}

/**
 * Generate diverse initiatives for the research objective
 */
export async function generateInitiatives(
  config: GenerateInitiativesConfig
): Promise<GenerateInitiativesResult> {
  const { doc: initialDoc, count = 3, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');
  let doc = initialDoc;
  let creditsUsed = 0;
  const initiativeIds: string[] = [];

  log('generateInitiatives', `Generating ${count} initiatives for: ${doc.objective}`);

  const spawnInitiativeTool = tool({
    description: 'Spawn a new research initiative to explore a specific angle',
    inputSchema: z.object({
      angle: z.string().describe('Short name for this research angle (2-5 words). E.g., "Podcast Production Agencies", "Enterprise Audio Teams"'),
      rationale: z.string().describe('WHY this angle makes sense - the reasoning behind exploring it. E.g., "These companies already produce audio content and need fact-checking to maintain credibility"'),
      question: z.string().describe('The specific research question to answer. E.g., "Which podcast agencies serve enterprise B2B clients and might need audio fact-checking?"'),
      maxCycles: z.number().min(1).max(10).default(5).describe('Max research→reflect cycles (default 5)'),
    }),
    execute: async ({ angle, rationale, question, maxCycles }) => {
      doc = addInitiative(doc, angle, rationale, question, maxCycles);
      const newInit = doc.initiatives[doc.initiatives.length - 1];
      initiativeIds.push(newInit.id);

      doc = addCortexDecision(doc, 'spawn', `Spawning initiative: ${angle} - ${rationale}`, newInit.id);

      onProgress?.({
        type: 'initiative_spawned',
        initiativeId: newInit.id,
        angle,
        rationale,
        question,
        maxCycles
      });

      return { success: true, initiativeId: newInit.id, angle };
    }
  });

  const systemPrompt = `You are Cortex, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

YOUR TASK: Generate ${count} DIVERSE research angles to explore this objective.

Each initiative needs THREE things:
1. ANGLE - Short name (2-5 words) for what you're exploring
2. RATIONALE - WHY this angle makes sense (the reasoning/connection to the goal)
3. QUESTION - The specific research question to answer

EXAMPLE (for "find B2B customers for audio fact-checking tool"):

Initiative 1:
- Angle: "Podcast Production Agencies"
- Rationale: "These companies produce audio content for enterprise clients and need fact-checking to protect their clients' brand reputation"
- Question: "Which podcast agencies serve B2B/enterprise clients and might need audio verification tools?"

Initiative 2:
- Angle: "Newsroom Audio Teams"
- Rationale: "News organizations with podcast/radio divisions face legal and reputational risks from inaccurate audio content"
- Question: "Which digital newsrooms have dedicated audio teams and a history of publishing corrections?"

Initiative 3:
- Angle: "Media Monitoring Platforms"
- Rationale: "These B2B companies already sell to newsrooms and could integrate or resell fact-checking as an add-on"
- Question: "Which media monitoring companies offer audio analysis and might want to add fact-checking capabilities?"

RULES:
- Each angle must be DIFFERENT (cover different segments/approaches)
- Rationale must explain WHY this angle connects to the goal
- Question must be specific and answerable through research
- Don't overlap too much between initiatives

Generate exactly ${count} initiatives using spawn_initiative for each.`;

  onProgress?.({ type: 'cortex_generating_initiatives', count });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `Generate ${count} diverse initiatives to explore the research objective. Use spawn_initiative for each one.`,
    tools: { spawn_initiative: spawnInitiativeTool },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  onProgress?.({
    type: 'cortex_initiatives_generated',
    count: initiativeIds.length,
    initiatives: doc.initiatives.filter(i => initiativeIds.includes(i.id)).map(i => ({
      id: i.id,
      hypothesis: i.hypothesis,
      goal: i.goal
    }))
  });

  return { doc, initiativeIds, creditsUsed };
}

// ============================================================
// Evaluation & Decision Making
// ============================================================

interface EvaluateInitiativesConfig {
  doc: CortexDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

type CortexNextAction =
  | { action: 'continue'; initiativeIds: string[] }
  | { action: 'drill_down'; initiativeId: string; angle: string; rationale: string; question: string }
  | { action: 'spawn_new'; angle: string; rationale: string; question: string }
  | { action: 'synthesize' };

interface EvaluateInitiativesResult {
  doc: CortexDoc;
  nextAction: CortexNextAction;
  reasoning: string;
  creditsUsed: number;
}

/**
 * Evaluate completed initiatives and decide next action
 */
export async function evaluateInitiatives(
  config: EvaluateInitiativesConfig
): Promise<EvaluateInitiativesResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');
  let doc = initialDoc;
  let creditsUsed = 0;

  const completed = getCompletedInitiatives(doc);
  const running = getRunningInitiatives(doc);
  const pending = getPendingInitiatives(doc);
  const allFindings = getAllActiveFindings(doc);

  log('evaluateInitiatives', 'Evaluating state:', {
    completed: completed.length,
    running: running.length,
    pending: pending.length,
    totalFindings: allFindings.length
  });

  const decideTool = tool({
    description: 'Decide what to do next based on initiative results',
    inputSchema: z.object({
      decision: z.enum(['continue', 'drill_down', 'spawn_new', 'synthesize']).describe(
        'continue=run more pending initiatives, drill_down=dive deeper into promising area, spawn_new=add new initiative, synthesize=we have enough, create final answer'
      ),
      reasoning: z.string().describe('Why this decision'),

      // For continue
      initiativeIds: z.array(z.string()).optional().describe('Which pending initiatives to run (for continue)'),

      // For drill_down
      drillDownInitiativeId: z.string().optional().describe('Which initiative to drill into'),
      drillDownAngle: z.string().optional().describe('New focused angle name (2-5 words)'),
      drillDownRationale: z.string().optional().describe('Why drill deeper into this area'),
      drillDownQuestion: z.string().optional().describe('New focused research question'),

      // For spawn_new
      newAngle: z.string().optional().describe('Angle name for new initiative (2-5 words)'),
      newRationale: z.string().optional().describe('Why this new angle is needed'),
      newQuestion: z.string().optional().describe('Research question for new initiative'),
    }),
    execute: async (params) => params
  });

  const systemPrompt = `You are Cortex, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CURRENT STATE:
${formatCortexDocForAgent(doc)}

SUMMARY:
- Completed initiatives: ${completed.length}
- Running initiatives: ${running.length}
- Pending initiatives: ${pending.length}
- Total active findings: ${allFindings.length}

${getInitiativesSummary(doc)}

---

EVALUATE and DECIDE what to do next:

OPTIONS:
1. CONTINUE - Run pending initiatives (if any remain)
2. DRILL_DOWN - One initiative is promising, create a focused follow-up
3. SPAWN_NEW - Need to explore a completely new angle
4. SYNTHESIZE - We have enough findings to answer the objective

DECISION CRITERIA:
- Have we satisfied the success criteria?
- Are the findings sufficient to answer the objective?
- Is there a promising angle that deserves deeper exploration?
- Are there gaps that need new initiatives?

Be decisive. Don't over-research - synthesize when you have enough.`;

  onProgress?.({ type: 'cortex_evaluating' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Evaluate the current state and decide the next action.',
    tools: { decide: decideTool },
    toolChoice: { type: 'tool', toolName: 'decide' },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const params = toolCall?.input || toolCall?.args || { decision: 'synthesize', reasoning: 'Fallback' };

  let nextAction: CortexNextAction;

  switch (params.decision) {
    case 'continue':
      const idsToRun = params.initiativeIds || pending.map(i => i.id);
      nextAction = { action: 'continue', initiativeIds: idsToRun };
      doc = addCortexDecision(doc, 'spawn', `Continuing with initiatives: ${idsToRun.join(', ')}`);
      break;

    case 'drill_down':
      nextAction = {
        action: 'drill_down',
        initiativeId: params.drillDownInitiativeId || '',
        angle: params.drillDownAngle || '',
        rationale: params.drillDownRationale || '',
        question: params.drillDownQuestion || ''
      };
      doc = addCortexDecision(
        doc,
        'drill_down',
        `Drilling down: ${params.drillDownAngle} - ${params.drillDownRationale}`,
        params.drillDownInitiativeId
      );
      break;

    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        angle: params.newAngle || '',
        rationale: params.newRationale || '',
        question: params.newQuestion || ''
      };
      doc = addCortexDecision(doc, 'spawn', `Spawning new: ${params.newAngle} - ${params.newRationale}`);
      break;

    case 'synthesize':
    default:
      nextAction = { action: 'synthesize' };
      doc = addCortexDecision(doc, 'synthesize', params.reasoning);
      doc = setDocStatus(doc, 'synthesizing');
      break;
  }

  onProgress?.({
    type: 'cortex_decision',
    decision: params.decision,
    reasoning: params.reasoning,
    nextAction
  });

  return {
    doc,
    nextAction,
    reasoning: params.reasoning,
    creditsUsed
  };
}

// ============================================================
// Synthesis
// ============================================================

interface SynthesizeConfig {
  doc: CortexDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface SynthesizeResult {
  doc: CortexDoc;
  finalAnswer: string;
  confidence: 'low' | 'medium' | 'high';
  creditsUsed: number;
}

/**
 * Synthesize final answer from all findings
 */
export async function synthesizeFinalAnswer(
  config: SynthesizeConfig
): Promise<SynthesizeResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');
  let doc = initialDoc;

  const allFindings = getAllActiveFindings(doc);

  log('synthesizeFinalAnswer', 'Starting synthesis with:', {
    objective: doc.objective,
    totalFindings: allFindings.length,
    initiatives: doc.initiatives.length
  });

  const synthesizeTool = tool({
    description: 'Deliver the final synthesized answer',
    inputSchema: z.object({
      confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer'),
      finalAnswer: z.string().describe('Complete, well-structured answer to the research objective'),
    }),
    execute: async ({ confidence, finalAnswer }) => ({ confidence, finalAnswer })
  });

  const systemPrompt = `You are synthesizing the final research answer.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

RESEARCH DOCUMENT:
${formatCortexDocForAgent(doc)}

ALL FINDINGS (${allFindings.length} total):
${allFindings.map(({ initiativeId, finding }) =>
  `- [${initiativeId}] ${finding.content}`
).join('\n')}

---

SYNTHESIZE a comprehensive final answer:
1. Address the objective directly
2. Reference the success criteria
3. Organize findings logically
4. Note any gaps or limitations
5. Provide actionable conclusions`;

  onProgress?.({ type: 'cortex_synthesizing' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Synthesize your final answer. Use the synthesize tool.',
    tools: { synthesize: synthesizeTool },
    toolChoice: { type: 'tool', toolName: 'synthesize' },
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const output = toolCall?.input || toolCall?.args || {
    confidence: 'low',
    finalAnswer: 'Research completed but no synthesis extracted.'
  };

  doc = setFinalAnswer(doc, output.finalAnswer);

  onProgress?.({
    type: 'cortex_synthesis_complete',
    confidence: output.confidence,
    answerLength: output.finalAnswer.length
  });

  return {
    doc,
    finalAnswer: output.finalAnswer,
    confidence: output.confidence,
    creditsUsed
  };
}

// ============================================================
// Adversarial Review (optional enhancement)
// ============================================================

interface ReviewConfig {
  doc: CortexDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ReviewResult {
  verdict: 'pass' | 'fail';
  critique: string;
  missing: string[];
  creditsUsed: number;
}

/**
 * Adversarial review of the research (optional quality gate)
 */
export async function adversarialReview(
  config: ReviewConfig
): Promise<ReviewResult> {
  const { doc, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');

  log('adversarialReview', 'Starting review for:', doc.objective);

  const reviewTool = tool({
    description: 'Deliver your adversarial review verdict',
    inputSchema: z.object({
      verdict: z.enum(['pass', 'fail']).describe('pass = research is sufficient, fail = gaps remain'),
      critique: z.string().describe('Why this passes or fails. Be specific.'),
      missing: z.array(z.string()).describe('What specific gaps remain (empty if pass)')
    }),
    execute: async ({ verdict, critique, missing }) => ({ verdict, critique, missing })
  });

  const systemPrompt = `You are a hostile reviewer. Your job is to block weak conclusions.
Assume the researcher is wrong unless proven otherwise.
Golden word is: relevance. How "relevant" is the output to what was asked?

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

RESEARCH DOCUMENT:
${formatCortexDocForAgent(doc)}

Evaluate harshly. Does the research actually address the objective and meet success criteria?
- If the evidence is weak or irrelevant → FAIL
- If success criteria are not met → FAIL
- If solid evidence addresses the objective → PASS`;

  onProgress?.({ type: 'cortex_review_started' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Review this research. Use the review tool to deliver your verdict.',
    tools: { review: reviewTool },
    toolChoice: { type: 'tool', toolName: 'review' },
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const output = toolCall?.input || toolCall?.args || {
    verdict: 'pass',
    critique: 'No review output',
    missing: []
  };

  onProgress?.({
    type: 'cortex_review_complete',
    verdict: output.verdict,
    critique: output.critique,
    missing: output.missing
  });

  return {
    ...output,
    creditsUsed
  };
}
