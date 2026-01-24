/**
 * Brain Agent
 *
 * The strategic thinker that plans and evaluates (but never searches):
 * 1. Generates research questions from the objective
 * 2. Evaluates question results
 * 3. Decides next actions (spawn new questions, synthesize)
 * 4. Writes the final answer
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { BrainDoc, ResearchQuestion } from '@/lib/types/research-question';
import {
  addResearchQuestion,
  addBrainDecision,
  setDocStatus,
  setFinalAnswer,
  formatBrainDocForAgent,
  getResearchQuestionsSummary,
  getAllActiveFindings,
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
 * Generate diverse questions for the research objective
 */
export async function generateResearchQuestions(
  config: GenerateResearchQuestionsConfig
): Promise<GenerateResearchQuestionsResult> {
  const { doc: initialDoc, count = 3, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;
  let creditsUsed = 0;
  const questionIds: string[] = [];

  log('generateResearchQuestions', `Generating ${count} questions for: ${doc.objective}`);

  let strategy = '';

  // Step 1: Generate strategy first
  const setStrategyTool = tool({
    description: 'Set the research strategy before creating questions',
    inputSchema: z.object({
      thinking: z.string().describe('Your thinking process in natural language. Write like you\'re explaining to a colleague: "First I\'ll look at X because... Then I\'ll explore Y to understand... After that I\'ll figure out how to continue based on what I find." (3-5 sentences, conversational)'),
    }),
    execute: async ({ thinking }) => {
      strategy = thinking;
      doc = { ...doc, researchStrategy: strategy };

      onProgress?.({
        type: 'brain_strategy',
        strategy: thinking,
      });

      return { success: true };
    }
  });

  const createQuestionTool = tool({
    description: 'Create a new research question',
    inputSchema: z.object({
      name: z.string().describe('Short name (2-5 words). E.g., "Podcast Networks", "Recent Funding"'),
      question: z.string().describe('The research question to answer. Short and clear.'),
      goal: z.string().describe('What we need to find out. E.g., "Find podcast networks that produce fact-heavy content"'),
      maxCycles: z.number().min(1).max(20).default(10).describe('Max search→reflect cycles (default 10)'),
    }),
    execute: async ({ name, question, goal, maxCycles }) => {
      doc = addResearchQuestion(doc, name, question, goal, maxCycles);
      const newQ = doc.questions[doc.questions.length - 1];
      questionIds.push(newQ.id);

      doc = addBrainDecision(doc, 'spawn', `Research question: ${name} - ${question}`, newQ.id);

      onProgress?.({
        type: 'question_spawned',
        questionId: newQ.id,
        name,
        question,
        goal,
        maxCycles
      });

      return { success: true, questionId: newQ.id, name };
    }
  });

  const strategyPrompt = `You are the Brain, the strategic research orchestrator.

Before generating research questions, explain your thinking in NATURAL LANGUAGE using set_strategy.

Write like you're talking to a colleague:
- "First I'll look at X because that's where we'll likely find..."
- "Then I'll dig into Y to understand..."
- "Based on what I find, I'll figure out whether to go deeper on Z or pivot to..."

DO NOT use numbered lists or formal headers. Just explain your thinking naturally.

Main objective: ${doc.objective}

Call set_strategy with your thinking.`;

  const questionsPrompt = `You are the Brain, the strategic research orchestrator.

YOUR STRATEGY:
${strategy || '(generating...)'}

Now generate ${count} PARALLEL and INDEPENDENT research questions that execute this strategy.

RULES:
- Questions run in parallel - they cannot depend on each other's outputs
- Each question should be specific and answerable via web search
- After round 1 finishes, you'll review and may spawn more questions

Main objective: ${doc.objective}

Call create_question for each question.`;

  onProgress?.({ type: 'brain_generating_questions', count });

  // Step 1: Generate strategy
  log('generateResearchQuestions', 'Generating strategy...');
  const strategyResult = await generateText({
    model,
    system: strategyPrompt,
    prompt: 'First, set your research strategy using set_strategy.',
    tools: { set_strategy: setStrategyTool },
    toolChoice: { type: 'tool', toolName: 'set_strategy' },
    abortSignal
  });
  creditsUsed += Math.ceil((strategyResult.usage?.totalTokens || 0) / 1000);
  log('generateResearchQuestions', 'Strategy set:', strategy);

  // Step 2: Generate questions
  let attempts = 0;
  const maxAttempts = count + 2;

  while (questionIds.length < count && attempts < maxAttempts) {
    attempts++;
    const remaining = count - questionIds.length;

    const result = await generateText({
      model,
      system: questionsPrompt,
      prompt: questionIds.length === 0
        ? `Create ${count} research questions. Call create_question for each.`
        : `You've created ${questionIds.length} questions. Create ${remaining} more.`,
      tools: { create_question: createQuestionTool },
      abortSignal
    });

    creditsUsed += Math.ceil((result.usage?.totalTokens || 0) / 1000);

    // If no tool calls were made, break to avoid infinite loop
    if (!result.toolCalls || result.toolCalls.length === 0) {
      log('generateResearchQuestions', `No tool calls made on attempt ${attempts}, breaking`);
      break;
    }
  }

  log('generateResearchQuestions', `Generated ${questionIds.length} questions after ${attempts} attempts`);

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
  | { action: 'spawn_new'; name: string; question: string; goal: string }
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
  let creditsUsed = 0;

  const completed = getCompletedResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const pending = getPendingResearchQuestions(doc);
  const allFindings = getAllActiveFindings(doc);

  log('evaluateResearchQuestions', 'Evaluating state:', {
    completed: completed.length,
    running: running.length,
    pending: pending.length,
    totalFindings: allFindings.length
  });

  const evaluateTool = tool({
    description: 'Evaluate progress and decide what to do next',
    inputSchema: z.object({
      decision: z.enum(['spawn_new', 'synthesize']).describe(
        'spawn_new=need to research something new, synthesize=we have enough, finish research'
      ),
      reasoning: z.string().describe('Why this decision'),

      // For spawn_new
      newName: z.string().optional().describe('Name for new question (2-5 words)'),
      newQuestion: z.string().optional().describe('The research question to answer'),
      newGoal: z.string().optional().describe('What we need to find out'),
    }),
    execute: async (params) => params
  });

  const systemPrompt = `You are the Brain, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CURRENT STATE:
${formatBrainDocForAgent(doc)}

SUMMARY:
- Completed questions: ${completed.length}
- Running questions: ${running.length}
- Pending questions: ${pending.length}
- Total active findings: ${allFindings.length}

${getResearchQuestionsSummary(doc)}

---

EVALUATE and DECIDE what to do next:

OPTIONS:
1. SPAWN_NEW - Need to research something new to answer the objective
2. SYNTHESIZE - We have enough findings, finish the research

DECISION CRITERIA:
- Have we satisfied the success criteria?
- Are the findings sufficient to answer the objective?
- Are there gaps that need new questions?
- Use EPISODES as your primary signal: each episode has a deltaType (progress/no_change/dead_end) and a delta.

CRITICAL BEHAVIOR:
- Treat the existing questions as an independent parallel round. After each round, do a batch review.
- For EACH success criterion, explicitly decide: covered vs not covered.
  - If NOT covered: you MUST choose SPAWN_NEW and create ONE new question targeted at that missing criterion.
  - If covered: cite which question(s) provide the evidence (use episodes/search results as signal).
- This is an iterative multi-round process and can take MANY ROUNDS (10–20+) if needed.
- Only choose SYNTHESIZE if ALL success criteria are covered OR the remaining gaps are explicitly declared as out-of-scope / not findable.

`;

  onProgress?.({ type: 'brain_evaluating' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Evaluate the current state and decide the next action.',
    tools: { evaluate: evaluateTool },
    toolChoice: { type: 'tool', toolName: 'evaluate' },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const params = toolCall?.input || toolCall?.args || { decision: 'synthesize', reasoning: 'Fallback' };

  let nextAction: BrainNextAction;

  switch (params.decision) {
    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        name: params.newName || '',
        question: params.newQuestion || '',
        goal: params.newGoal || ''
      };
      doc = addBrainDecision(doc, 'spawn', `Spawning new: ${params.newName} - ${params.newQuestion}`);
      break;

    case 'synthesize':
    default:
      nextAction = { action: 'synthesize' };
      doc = addBrainDecision(doc, 'synthesize', params.reasoning);
      doc = setDocStatus(doc, 'synthesizing');
      break;
  }

  onProgress?.({
    type: 'brain_decision',
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
 * Synthesize final answer from all findings
 */
export async function synthesizeFinalAnswer(
  config: SynthesizeConfig
): Promise<SynthesizeResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;

  const allFindings = getAllActiveFindings(doc);

  log('synthesizeFinalAnswer', 'Starting synthesis with:', {
    objective: doc.objective,
    totalFindings: allFindings.length,
    questions: doc.questions.length
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
${formatBrainDocForAgent(doc)}

ALL FINDINGS (${allFindings.length} total):
${allFindings.map(({ questionId, finding }) =>
  `- [${questionId}] ${finding.content}`
).join('\n')}

---

SYNTHESIZE a comprehensive final answer:
1. Address the objective directly
2. Reference the success criteria
3. Organize findings logically
4. Note any gaps or limitations
5. Provide actionable conclusions`;

  onProgress?.({ type: 'brain_synthesizing' });

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
    type: 'brain_synthesis_complete',
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
