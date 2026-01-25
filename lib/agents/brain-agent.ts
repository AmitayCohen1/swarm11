/**
 * Brain Agent
 *
 * The strategic thinker that plans and evaluates (but never searches):
 * 1. Generates research questions from the objective
 * 2. Evaluates question results
 * 3. Decides next actions (spawn new questions, synthesize)
 * 4. Writes the final answer
 *
 * ARCHITECTURE:
 * All functions use generateObject for structured output.
 * No fake tools - just clean LLM calls that return structured data.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { BrainDoc } from '@/lib/types/research-question';
import {
  addResearchQuestion,
  addBrainDecision,
  setDocStatus,
  setFinalAnswer,
  formatBrainDocForAgent,
  getResearchQuestionsSummary,
  getCompletedResearchQuestions,
  getRunningResearchQuestions,
  getPendingResearchQuestions,
} from '@/lib/utils/question-operations';

// Logging helper
const log = (fn: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `[BrainAgent ${timestamp}] [${fn}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
};



// ============================================================
// Schemas
// ============================================================

const QuestionSchema = z.object({
  name: z.string().describe('Tab label (2-4 words).'),
  question: z.string().describe('Short, precise question (max 15 words).'),
  description: z.string().describe('Explain how this question helps the main objective (2-3 sentences). '),
  goal: z.string().describe('Whats the goal of that question? Must be a single goal, and very spesific and clear.'),
});

const EvaluateSchema = z.object({
  decision: z.enum(['spawn_new', 'synthesize']).describe('spawn_new=need more research, synthesize=we have enough'),
  strategy: z.string().optional().describe('For kickoff only: Your initial thinking about the biggest unknowns.'),
  keyFindings: z.string().describe('2-3 sentence summary of what we learned (or "Kickoff - no research yet" for first round).'),
  gaps: z.string().describe('What information is still missing?'),
  reasoning: z.string().describe('Your decision rationale combining findings and gaps.'),
  questions: z.array(QuestionSchema).max(5).describe('Research questions to spawn in parallel. Empty array if synthesize.'),
});

const SynthesizeSchema = z.object({
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer'),
  finalAnswer: z.string().describe('Complete, well-structured answer to the research objective'),
});

// ============================================================
// Evaluation & Decision Making (also handles kickoff)
// ============================================================

interface EvaluateResearchQuestionsConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

type BrainNextAction =
  | { action: 'spawn_new'; questions: Array<{ name: string; question: string; description: string; goal: string }> }
  | { action: 'synthesize' };

interface EvaluateResearchQuestionsResult {
  doc: BrainDoc;
  nextAction: BrainNextAction;
  reasoning: string;
  creditsUsed: number;
}

/**
 * Evaluate research state and decide next action.
 * Handles both kickoff (first time, no questions yet) and subsequent evaluations.
 */
export async function evaluateResearchQuestions(
  config: EvaluateResearchQuestionsConfig
): Promise<EvaluateResearchQuestionsResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;

  const isKickoff = doc.questions.length === 0;
  const completed = getCompletedResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const pending = getPendingResearchQuestions(doc);

  const totalMemory = doc.questions.reduce((sum, q) => sum + q.memory.length, 0);

  log('evaluateResearchQuestions', isKickoff ? 'Kickoff - generating initial questions' : 'Evaluating state:', {
    isKickoff,
    completed: completed.length,
    running: running.length,
    pending: pending.length,
    totalMemory
  });

  // Build prompt - kickoff vs evaluation
  const prompt = isKickoff
    ? `You are the Brain of an autonomous research agent.

OBJECTIVE: ${doc.objective}

Success criteria:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**THIS IS KICKOFF** - Your job is to start with a few exploratory questions to answer the biggest unknowns and get a sense of the landscape.

Provide:
1. STRATEGY - What are the biggest unknowns? What do you need to learn first?
2. QUESTIONS - 3-5 short exploratory questions:
   - Each question runs IN PARALLEL by a separate researcher (they don't share context)
   - Answer the biggest unknowns, start broad and slowly narrow down
   - Keep them SHORT (max 15 words)

For keyFindings, write "Kickoff - no research yet".`
    : `You are the Brain of the research.

Main research objective:
${doc.objective}

Success criteria:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Current state:
${formatBrainDocForAgent(doc)}

Summary:
${getResearchQuestionsSummary(doc)}

---

Evaluate and decide what to do next:
- Do we have enough information to answer the main research objective?
- If not, what do we want to learn next? Which research questions could get us closer to understanding the main research objective?

Your response must include:
- KEY FINDINGS - Summarize what we learned (2-3 sentences). Be specific: names, numbers, facts.
- GAPS - What's still missing to satisfy success criteria?
- REASONING - Your decision based on findings and gaps.

CRITICAL BEHAVIOR:
- This is iterative - can take many rounds if needed.
- Only synthesize if ALL success criteria are covered OR gaps are declared unfindable.
- When spawning, provide questions that explore different gaps (they run in parallel, don't share context)
- Questions must be short and specific (max 15 words each).`;

  onProgress?.({ type: isKickoff ? 'brain_kickoff' : 'brain_evaluating' });

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: EvaluateSchema }),
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);
  const params = result.output as z.infer<typeof EvaluateSchema>;

  // For kickoff, store strategy if provided
  if (isKickoff && params.strategy) {
    doc = { ...doc, researchStrategy: params.strategy };
    onProgress?.({ type: 'brain_strategy', strategy: params.strategy });
  }

  // Build rich reasoning from findings + gaps + reasoning
  const richReasoning = [
    params.strategy && isKickoff && `Strategy: ${params.strategy}`,
    params.keyFindings && params.keyFindings !== 'Kickoff - no research yet' && `We found: ${params.keyFindings}`,
    params.gaps && `Still needed: ${params.gaps}`,
    params.reasoning
  ].filter(Boolean).join(' ');

  let nextAction: BrainNextAction;

  switch (params.decision) {
    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        questions: params.questions || []
      };
      doc = addBrainDecision(doc, 'spawn', richReasoning);
      break;

    case 'synthesize':
    default:
      nextAction = { action: 'synthesize' };
      doc = addBrainDecision(doc, 'synthesize', richReasoning);
      doc = setDocStatus(doc, 'synthesizing');
      break;
  }

  onProgress?.({
    type: 'brain_decision',
    decision: params.decision,
    reasoning: richReasoning,
    keyFindings: params.keyFindings,
    gaps: params.gaps,
    strategy: params.strategy,
    isKickoff,
    nextAction
  });

  return {
    doc,
    nextAction,
    reasoning: richReasoning,
    creditsUsed
  };
}

// ============================================================
// Synthesis
// ============================================================

interface SynthesizeConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface SynthesizeResult {
  doc: BrainDoc;
  finalAnswer: string;
  confidence: 'low' | 'medium' | 'high';
  creditsUsed: number;
}

/**
 * Synthesize final answer from all question documents
 */
export async function synthesizeFinalAnswer(
  config: SynthesizeConfig
): Promise<SynthesizeResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;

  // Collect question documents
  const questionDocs = doc.questions
    .filter(q => q.status === 'done' && q.document)
    .map(q => ({
      name: q.name,
      question: q.question,
      document: q.document!,
      confidence: q.confidence,
    }));

  log('synthesizeFinalAnswer', 'Starting synthesis with:', {
    objective: doc.objective,
    questionDocuments: questionDocs.length,
    totalQuestions: doc.questions.length
  });

  // Format question documents for the prompt
  const formatQuestionDoc = (qd: typeof questionDocs[0], index: number) => {
    const qdoc = qd.document;
    const findings = qdoc.keyFindings.map(f => `  • ${f}`).join('\n');
    const sources = qdoc.sources.slice(0, 3).map(s => `  - ${s.title}: ${s.contribution}`).join('\n');
    return `
### ${index + 1}. ${qd.name}
**Question:** ${qd.question}
**Confidence:** ${qd.confidence || 'medium'}

**Answer:**
${qdoc.answer}

**Key Findings:**
${findings}

**Sources:**
${sources}
${qdoc.limitations ? `\n**Limitations:** ${qdoc.limitations}` : ''}`;
  };

  // PROMPT GOAL: Combine all research findings into one comprehensive final answer
  const prompt = `You are synthesizing the final research answer from ${questionDocs.length} research documents.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

## RESEARCH DOCUMENTS

${questionDocs.map((qd, i) => formatQuestionDoc(qd, i)).join('\n\n---\n')}

---

SYNTHESIZE a comprehensive final answer:
1. Address the objective directly
2. Check each success criterion - is it satisfied?
3. Combine findings from all documents into a coherent narrative
4. Include specific facts, names, and numbers from the research
5. Note any gaps or limitations
6. Provide actionable conclusions`;

  onProgress?.({ type: 'brain_synthesizing' });

  const result = await generateText({
    model,
    prompt,
    output: Output.object({ schema: SynthesizeSchema }),
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);
  const { confidence, finalAnswer } = result.output as z.infer<typeof SynthesizeSchema>;

  doc = setFinalAnswer(doc, finalAnswer);

  onProgress?.({
    type: 'brain_synthesis_complete',
    confidence,
    answerLength: finalAnswer.length
  });

  return {
    doc,
    finalAnswer,
    confidence,
    creditsUsed
  };
}
