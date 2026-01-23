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
    description: 'Spawn a new research question to explore a specific angle',
    inputSchema: z.object({
      name: z.string().describe('Short name for this question (2-5 words). E.g., "Corporate Training Providers", "Healthcare Communication Platforms"'),
      description: z.string().describe('What this question is about and why it matters. E.g., "These companies produce large volumes of audio training content where accuracy is critical for compliance"'),
      goal: z.string().describe('What we\'re looking to achieve/answer. E.g., "Find corporate training companies that use audio content and might need fact-checking tools"'),
      maxCycles: z.number().min(1).max(20).default(10).describe('Max research→reflect cycles (default 10)'),
    }),
    execute: async ({ name, description, goal, maxCycles }) => {
      doc = addResearchQuestion(doc, name, description, goal, maxCycles);
      const newInit = doc.questions[doc.questions.length - 1];
      questionIds.push(newInit.id);

      doc = addCortexDecision(doc, 'spawn', `Spawning question: ${name} - ${description}`, newInit.id);

      onProgress?.({
        type: 'question_spawned',
        questionId: newInit.id,
        name,
        description,
        goal,
        maxCycles
      });

      return { success: true, questionId: newInit.id, name };
    }
  });

  const systemPrompt = `You are Cortex, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

IMPORTANT CONTEXT:
This is a LONG-RUNNING autonomous research process. The system will run for as long as needed -
potentially hours - exploring each question thoroughly. There is no rush.

Take the time to think deeply about the BEST angles to explore. Quality matters more than speed.
Each question will be researched extensively with multiple search cycles, so choose angles that
will yield the most valuable and relevant results.

Think strategically:
- What angles are most likely to find actionable, relevant information?
- What diverse perspectives will give the most complete picture?
- Which directions might uncover insights the user hasn't thought of?

---

YOUR TASK: Generate ${count} DIVERSE research angles to explore this objective.

Each question needs THREE things:
1. NAME - Short name (2-5 words) for this question
2. DESCRIPTION - What this question is about and why it matters
3. GOAL - What we're looking to achieve/answer

EXAMPLE (for "find B2B customers for audio fact-checking tool"):

ResearchQuestion 1:
- Name: "Corporate Training Providers"
- Description: "These companies produce large volumes of audio training content where accuracy is critical for compliance and effective learning"
- Goal: "Find corporate training companies that use audio content and might need fact-checking tools"

ResearchQuestion 2:
- Name: "Healthcare Communication Platforms"
- Description: "Healthcare platforms handle sensitive verbal information including medical advice where factual errors can have serious consequences"
- Goal: "Identify healthcare communication companies processing audio that could benefit from fact verification"

ResearchQuestion 3:
- Name: "Legal Deposition Services"
- Description: "Legal firms and transcription services record and review depositions where accurate audio records are legally vital"
- Goal: "Find legal deposition and transcription providers who might need audio fact-checking capabilities"

RULES:
- Each question must be DIFFERENT (cover different segments/approaches)
- Description must explain WHAT this is and WHY it matters
- Goal must be specific and achievable through research
- Don't overlap too much between questions

Generate exactly ${count} questions using spawn_question for each.`;

  onProgress?.({ type: 'cortex_generating_questions', count });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `Generate ${count} diverse questions to explore the research objective. Use spawn_question for each one.`,
    tools: { spawn_question: spawnResearchQuestionTool },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

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

THIS INITIATIVE:
- Name: ${question.name}
- Description: ${question.description}
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
  | { action: 'continue'; questionIds: string[] }
  | { action: 'drill_down'; questionId: string; name: string; description: string; goal: string }
  | { action: 'spawn_new'; name: string; description: string; goal: string }
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
      decision: z.enum(['continue', 'drill_down', 'spawn_new', 'synthesize']).describe(
        'continue=run more pending questions, drill_down=dive deeper into promising area, spawn_new=add new question, synthesize=we have enough, create final answer'
      ),
      reasoning: z.string().describe('Why this decision'),

      // For continue
      questionIds: z.array(z.string()).optional().describe('Which pending questions to run (for continue)'),

      // For drill_down
      drillDownResearchQuestionId: z.string().optional().describe('Which question to drill into'),
      drillDownName: z.string().optional().describe('New focused question name (2-5 words)'),
      drillDownDescription: z.string().optional().describe('What this drill-down is about and why'),
      drillDownGoal: z.string().optional().describe('What we\'re looking to achieve with this drill-down'),

      // For spawn_new
      newName: z.string().optional().describe('Name for new question (2-5 words)'),
      newDescription: z.string().optional().describe('What this question is about and why'),
      newGoal: z.string().optional().describe('What we\'re looking to achieve'),
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
1. CONTINUE - Run pending questions (if any remain)
2. DRILL_DOWN - One question is promising, create a focused follow-up
3. SPAWN_NEW - Need to explore a completely new angle
4. SYNTHESIZE - We have enough findings to answer the objective

DECISION CRITERIA:
- Have we satisfied the success criteria?
- Are the findings sufficient to answer the objective?
- Is there a promising angle that deserves deeper exploration?
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
    case 'continue':
      const idsToRun = params.questionIds || pending.map(i => i.id);
      nextAction = { action: 'continue', questionIds: idsToRun };
      doc = addCortexDecision(doc, 'spawn', `Continuing with questions: ${idsToRun.join(', ')}`);
      break;

    case 'drill_down':
      nextAction = {
        action: 'drill_down',
        questionId: params.drillDownResearchQuestionId || '',
        name: params.drillDownName || '',
        description: params.drillDownDescription || '',
        goal: params.drillDownGoal || ''
      };
      doc = addCortexDecision(
        doc,
        'drill_down',
        `Drilling down: ${params.drillDownName} - ${params.drillDownDescription}`,
        params.drillDownResearchQuestionId
      );
      break;

    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        name: params.newName || '',
        description: params.newDescription || '',
        goal: params.newGoal || ''
      };
      doc = addCortexDecision(doc, 'spawn', `Spawning new: ${params.newName} - ${params.newDescription}`);
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
