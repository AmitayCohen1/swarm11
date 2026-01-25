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

import { generateObject, generateText } from 'ai';
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

interface BrainAgentConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

// ============================================================
// Schemas
// ============================================================

const QuestionSchema = z.object({
  name: z.string().describe('Tab label (2-4 words). E.g., "Podcast Networks"'),
  question: z.string().describe('Short, precise question (max 15 words). E.g., "Which podcast networks have the biggest advertising budgets?"'),
  description: z.string().describe('Explain how this question helps the main objective (2-3 sentences). Start with "This will help us understand..."'),
  goal: z.string().describe('What specific output we need (1 sentence). E.g., "List of 10+ networks with their estimated ad revenue."'),
});

const KickoffSchema = z.object({
  strategy: z.string().describe('Your initial thinking about the biggest unknowns. What do we need to figure out first? (2-3 sentences, conversational)'),
  questions: z.array(QuestionSchema).min(1).max(5).describe('Parallel research questions'),
});

const EvaluateSchema = z.object({
  decision: z.enum(['spawn_new', 'synthesize']).describe('spawn_new=need to research something new, synthesize=we have enough'),
  keyFindings: z.string().describe('2-3 sentence summary of what we learned. Be specific: names, numbers, facts.'),
  gaps: z.string().describe('What information is still missing?'),
  reasoning: z.string().describe('Your decision rationale combining findings and gaps.'),
  // For spawn_new
  name: z.string().optional().describe('Tab label (2-4 words)'),
  question: z.string().optional().describe('Short, precise question (max 15 words)'),
  description: z.string().optional().describe('Explain how this helps the objective (2-3 sentences)'),
  goal: z.string().optional().describe('What specific output we need (1 sentence)'),
});

const SynthesizeSchema = z.object({
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer'),
  finalAnswer: z.string().describe('Complete, well-structured answer to the research objective'),
});

// ============================================================
// ResearchQuestion Generation
// ============================================================

interface GenerateResearchQuestionsConfig {
  doc: BrainDoc;
  count?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface GenerateResearchQuestionsResult {
  doc: BrainDoc;
  questionIds: string[];
  creditsUsed: number;
}

/**
 * Generate strategy + questions in one coherent thought
 */
export async function generateResearchQuestions(
  config: GenerateResearchQuestionsConfig
): Promise<GenerateResearchQuestionsResult> {
  const { doc: initialDoc, count = 3, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;
  const questionIds: string[] = [];

  log('generateResearchQuestions', `Generating strategy + ${count} questions for: ${doc.objective}`);

  const prompt = `You are the brain of an autonomous research agent.

OBJECTIVE: ${doc.objective}

Your job is NOT to plan the entire research end-to-end. Instead, start with ${count} exploratory questions to answer the biggest unknowns and get a sense of the landscape.

Think of it like: "Before I can even plan this properly, I need to understand X, Y, and Z."

Provide:

1. STRATEGY - What are the biggest unknowns? What do you need to learn first?
   Keep it short (2-3 sentences). Example:
   "The biggest unknown is whether podcast networks even have public ad sales contacts. Let me also check what budget ranges look like. Once I see what's out there, I'll know where to dig deeper."

2. QUESTIONS - ${count} exploratory questions:
   - Answer different big unknowns
   - Keep them SHORT (max 15 words)
   - Good: "Do podcast networks publish ad sales contact info?"
   - Bad: "What are the top 20-40 verified concrete outreach targets with contact information..."

Don't try to solve everything. Just get a sense of the landscape first.`;

  onProgress?.({ type: 'brain_generating_questions', count });

  log('generateResearchQuestions', 'Generating strategy + questions...');

  const result = await generateObject({
    model,
    prompt,
    schema: KickoffSchema,
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);
  const { strategy, questions } = result.object;

  // Apply strategy to doc
  doc = { ...doc, researchStrategy: strategy };

  onProgress?.({
    type: 'brain_strategy',
    strategy,
  });

  // Log the strategy as brain decision
  doc = addBrainDecision(doc, 'spawn', strategy);

  // Create questions
  for (const q of questions) {
    doc = addResearchQuestion(doc, q.name, q.question, q.goal, 30, q.description);
    const newQ = doc.questions[doc.questions.length - 1];
    questionIds.push(newQ.id);

    onProgress?.({
      type: 'question_spawned',
      questionId: newQ.id,
      name: q.name,
      question: q.question,
      description: q.description,
      goal: q.goal,
    });
  }

  log('generateResearchQuestions', `Generated ${questionIds.length} questions`);

  onProgress?.({
    type: 'brain_questions_generated',
    count: questionIds.length,
    questions: doc.questions.filter(i => questionIds.includes(i.id)).map(i => ({
      id: i.id,
      name: i.name,
      goal: i.goal
    }))
  });

  return { doc, questionIds, creditsUsed };
}

// ============================================================
// Evaluation & Decision Making
// ============================================================

interface EvaluateResearchQuestionsConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

type BrainNextAction =
  | { action: 'spawn_new'; name: string; question: string; description: string; goal: string }
  | { action: 'synthesize' };

interface EvaluateResearchQuestionsResult {
  doc: BrainDoc;
  nextAction: BrainNextAction;
  reasoning: string;
  creditsUsed: number;
}

/**
 * Evaluate completed questions and decide next action
 */
export async function evaluateResearchQuestions(
  config: EvaluateResearchQuestionsConfig
): Promise<EvaluateResearchQuestionsResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;

  const completed = getCompletedResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const pending = getPendingResearchQuestions(doc);

  const totalMemory = doc.questions.reduce((sum, q) => sum + q.memory.length, 0);

  log('evaluateResearchQuestions', 'Evaluating state:', {
    completed: completed.length,
    running: running.length,
    pending: pending.length,
    totalMemory
  });

  const prompt = `You are the Brain, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CURRENT STATE:
${formatBrainDocForAgent(doc)}

SUMMARY:
${getResearchQuestionsSummary(doc)}

---

EVALUATE and DECIDE what to do next.

YOUR RESPONSE MUST INCLUDE:
1. KEY FINDINGS - Summarize what we learned (2-3 sentences). Be specific: names, numbers, facts.
   Example: "We identified 15 podcast networks including Gimlet, Wondery, and iHeart. Found that Gimlet was acquired by Spotify for $230M..."

2. GAPS - What's still missing to satisfy success criteria?
   Example: "We still need direct contact emails for ad sales teams and typical budget ranges."

3. REASONING - Your decision based on findings and gaps.
   Example: "We have good coverage of networks but lack actionable contact info. Let's dig into specific contact details..."

OPTIONS:
- SPAWN_NEW: Create a new focused research question (short and precise, max 15 words)
- SYNTHESIZE: We have enough, finish the research

CRITICAL BEHAVIOR:
- This is iterative - can take MANY ROUNDS (10–20+) if needed.
- For EACH success criterion: is it covered or not?
- Only SYNTHESIZE if ALL criteria are covered OR gaps are declared unfindable.
- New questions must be SHORT and SPECIFIC (max 15 words).`;

  onProgress?.({ type: 'brain_evaluating' });

  const result = await generateObject({
    model,
    prompt,
    schema: EvaluateSchema,
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);
  const params = result.object;

  // Build rich reasoning from findings + gaps + reasoning
  const richReasoning = [
    params.keyFindings && `We found: ${params.keyFindings}`,
    params.gaps && `Still needed: ${params.gaps}`,
    params.reasoning
  ].filter(Boolean).join(' ');

  let nextAction: BrainNextAction;

  switch (params.decision) {
    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        name: params.name || '',
        question: params.question || '',
        description: params.description || '',
        goal: params.goal || ''
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

  const result = await generateObject({
    model,
    prompt,
    schema: SynthesizeSchema,
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);
  const { confidence, finalAnswer } = result.object;

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
