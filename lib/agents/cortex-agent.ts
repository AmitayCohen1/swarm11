/**
 * Cortex Agent
 *
 * The orchestrating intelligence that:
 * 1. Generates diverse questions from the objective
 * 2. Evaluates question results
 * 3. Decides next actions (drill down, spawn new, synthesize)
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { CortexDoc, ResearchQuestion } from '@/lib/types/research-question';
import {
  addResearchQuestion,
  addCortexDecision,
  setDocStatus,
  setFinalAnswer,
  formatCortexDocForAgent,
  getResearchQuestionsSummary,
  getAllActiveFindings,
  getCompletedResearchQuestions,
  getRunningResearchQuestions,
  getPendingResearchQuestions,
} from '@/lib/utils/question-operations';

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
// ResearchQuestion Generation
// ============================================================

interface GenerateResearchQuestionsConfig {
  doc: CortexDoc;
  count?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface GenerateResearchQuestionsResult {
  doc: CortexDoc;
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
  const model = openai('gpt-4.1');
  let doc = initialDoc;
  let creditsUsed = 0;
  const questionIds: string[] = [];

  log('generateResearchQuestions', `Generating ${count} questions for: ${doc.objective}`);

  const spawnResearchQuestionTool = tool({
    description: 'Spawn a new research question',
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

      doc = addCortexDecision(doc, 'spawn', `Research question: ${name} - ${question}`, newQ.id);

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

  const systemPrompt = `You are Cortex, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

YOUR TASK: Form a few initial research questions that will get us closer to provide the answer based on the user objective.

What do you need to know to answer the objective?
What do we need to research?

---

RULES:
- Each question should be TESTABLE through web research
- Questions should be DIFFERENT from each other (different angles/beliefs)
- Don't just restate the objective - form actual questions about what might be true
- Together, testing these questions should help answer the objective

Generate questions using spawn_question.`;

  onProgress?.({ type: 'cortex_generating_questions', count });

  // Loop to ensure we get the requested number of questions
  // The LLM might only call the tool once per turn, so we retry until we have enough
  let attempts = 0;
  const maxAttempts = count + 2;

  while (questionIds.length < count && attempts < maxAttempts) {
    attempts++;
    const remaining = count - questionIds.length;

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: questionIds.length === 0
        ? `Form ${count} questions. Call spawn_question for each question.`
        : `You've created ${questionIds.length} questions so far. Create ${remaining} more. Call spawn_question for each.`,
      tools: { spawn_question: spawnResearchQuestionTool },
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
    type: 'cortex_questions_generated',
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
// ResearchQuestion Summarization
// ============================================================

interface SummarizeResearchQuestionConfig {
  doc: CortexDoc;
  questionId: string;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface SummarizeResearchQuestionResult {
  doc: CortexDoc;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  recommendation: 'promising' | 'dead_end' | 'needs_more';
  creditsUsed: number;
}

/**
 * Summarize a completed question - called when reflect says "done"
 * This agent looks at ALL search results and findings to produce a comprehensive summary
 */
export async function summarizeResearchQuestion(
  config: SummarizeResearchQuestionConfig
): Promise<SummarizeResearchQuestionResult> {
  const { doc: initialDoc, questionId, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');
  let doc = initialDoc;

  const question = doc.questions.find(i => i.id === questionId);
  if (!question) {
    throw new Error(`ResearchQuestion ${questionId} not found`);
  }

  log('summarizeResearchQuestion', `Summarizing question: ${question.name}`, {
    searchResults: question.searchResults?.length || 0,
    findings: question.findings.length,
    cycles: question.cycles
  });

  const summarizeTool = tool({
    description: 'Deliver the question summary',
    inputSchema: z.object({
      summary: z.string().describe('Comprehensive summary of what was found in this question. Include key insights, patterns, and actionable information.'),
      confidence: z.enum(['low', 'medium', 'high']).describe('How confident are we in these findings? low=sparse/uncertain, medium=decent coverage, high=strong evidence'),
      recommendation: z.enum(['promising', 'dead_end', 'needs_more']).describe('promising=found valuable info worth pursuing, dead_end=this angle didnt pan out, needs_more=partial findings need deeper research'),
    }),
    execute: async ({ summary, confidence, recommendation }) => ({ summary, confidence, recommendation })
  });

  // Build context from all search results
  const searchContext = (question.searchResults || []).map((sr, i) =>
    `Search ${i + 1}: "${sr.query}"
Answer: ${sr.answer}
${sr.learned ? `Learned: ${sr.learned}` : ''}
${sr.nextAction ? `Next planned: ${sr.nextAction}` : ''}
Sources: ${sr.sources.map(s => s.url).join(', ') || 'none'}`
  ).join('\n\n');

  const findingsContext = question.findings
    .filter(f => f.status !== 'disqualified')
    .map((f, i) => `Finding ${i + 1}: ${f.content}`)
    .join('\n');

  const systemPrompt = `You are summarizing the results of a research question.

OVERALL RESEARCH OBJECTIVE: ${doc.objective}

THIS RESEARCH QUESTION:
- Name: ${question.name}
- Question: ${question.question}
- Goal: ${question.goal}
- Cycles completed: ${question.cycles}

ALL SEARCH RESULTS (${question.searchResults?.length || 0} searches):
${searchContext || 'No searches performed'}

EXTRACTED FINDINGS (${question.findings.filter(f => f.status !== 'disqualified').length} findings):
${findingsContext || 'No findings extracted'}

---

YOUR TASK: Create a comprehensive summary of this question's results.

The summary should:
1. Synthesize key insights from all the searches
2. Highlight the most valuable/actionable information found
3. Note any patterns or themes that emerged
4. Acknowledge gaps or limitations
5. Be specific - include names, numbers, details found

Be thorough but concise. This summary will be used by the orchestrator to understand what this question discovered.`;

  onProgress?.({ type: 'question_summarizing', questionId, name: question.name });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Summarize this question\'s findings. Use the summarize tool.',
    tools: { summarize: summarizeTool },
    toolChoice: { type: 'tool', toolName: 'summarize' },
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const output = toolCall?.input || toolCall?.args || {
    summary: 'ResearchQuestion completed but no summary extracted.',
    confidence: 'low',
    recommendation: 'needs_more'
  };

  log('summarizeResearchQuestion', `Summary complete for ${question.name}:`, {
    confidence: output.confidence,
    recommendation: output.recommendation,
    summaryLength: output.summary.length
  });

  onProgress?.({
    type: 'question_summarized',
    questionId,
    summary: output.summary,
    confidence: output.confidence,
    recommendation: output.recommendation
  });

  return {
    doc,
    summary: output.summary,
    confidence: output.confidence,
    recommendation: output.recommendation,
    creditsUsed
  };
}

// ============================================================
// Evaluation & Decision Making
// ============================================================

interface EvaluateResearchQuestionsConfig {
  doc: CortexDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

type CortexNextAction =
  | { action: 'spawn_new'; name: string; question: string; goal: string }
  | { action: 'synthesize' };

interface EvaluateResearchQuestionsResult {
  doc: CortexDoc;
  nextAction: CortexNextAction;
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
  const model = openai('gpt-4.1');
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

  const decideTool = tool({
    description: 'Decide what to do next based on question results',
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

  const systemPrompt = `You are Cortex, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CURRENT STATE:
${formatCortexDocForAgent(doc)}

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
    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        name: params.newName || '',
        question: params.newQuestion || '',
        goal: params.newGoal || ''
      };
      doc = addCortexDecision(doc, 'spawn', `Spawning new: ${params.newName} - ${params.newQuestion}`);
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
${formatCortexDocForAgent(doc)}

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

