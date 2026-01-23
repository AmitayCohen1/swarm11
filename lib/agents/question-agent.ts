/**
 * ResearchQuestion Agent
 *
 * Runs search→reflect loop for a single question/hypothesis.
 * Simple: just search and reflect, nothing else.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { CortexDoc } from '@/lib/types/research-question';
import {
  addSearchResultToResearchQuestion,
  addReflectionToResearchQuestion,
  incrementResearchQuestionCycle,
  completeResearchQuestion,
  formatResearchQuestionForAgent,
  getResearchQuestion,
} from '@/lib/utils/question-operations';
import { summarizeResearchQuestion } from './cortex-agent';

// Logging helper
const log = (questionId: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const shortId = questionId.substring(0, 12);
  const prefix = `[ResearchQuestion ${timestamp}] [${shortId}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
};

interface ResearchQuestionAgentConfig {
  doc: CortexDoc;
  questionId: string;
  objective: string;
  successCriteria: string[];
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ResearchQuestionAgentResult {
  doc: CortexDoc;
  shouldContinue: boolean;
  queriesExecuted: string[];
  creditsUsed: number;
}

/**
 * Execute a single cycle of search→reflect for a question
 */
export async function executeResearchQuestionCycle(
  config: ResearchQuestionAgentConfig
): Promise<ResearchQuestionAgentResult> {
  const {
    doc: initialDoc,
    questionId,
    objective,
    successCriteria,
    maxIterations = 10,
    abortSignal,
    onProgress,
  } = config;

  const model = openai('gpt-4.1');
  let doc = initialDoc;
  let creditsUsed = 0;
  const queriesExecuted: string[] = [];

  const question = getResearchQuestion(doc, questionId);
  if (!question) {
    console.warn(`[ResearchQuestionAgent] ResearchQuestion ${questionId} not found`);
    return { doc, shouldContinue: false, queriesExecuted, creditsUsed };
  }

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  // Increment cycle counter
  doc = incrementResearchQuestionCycle(doc, questionId);
  const currentQuestion = getResearchQuestion(doc, questionId)!;
  const cycleNumber = currentQuestion.cycles;

  log(questionId, `──── CYCLE ${cycleNumber}/${currentQuestion.maxCycles} START ────`);
  log(questionId, `Question: ${currentQuestion.question}`);
  log(questionId, `Goal: ${currentQuestion.goal}`);

  // Check if max cycles reached
  if (cycleNumber > currentQuestion.maxCycles) {
    log(questionId, `MAX CYCLES REACHED - calling summarizer`);
    return await finishQuestion(doc, questionId, abortSignal, onProgress, creditsUsed);
  }

  // Tool: Reflect - what you learned and what's next
  const reflectTool = tool({
    description: 'Reflect after searching. Say what you learned and decide next step.',
    inputSchema: z.object({
      learned: z.string().describe('What you learned from the search. Be specific.'),
      answerProgress: z.enum(['closer', 'no_change', 'dead_end']).describe('Are we closer to answering the question, no change, or hit a dead end?'),
      nextStep: z.string().describe('What you will search next, OR why you are done.'),
      status: z.enum(['continue', 'done']).describe('continue = search more, done = question answered or exhausted'),
    }),
    execute: async ({ learned, answerProgress, nextStep, status }) => {
      // Update the most recent search result with the learned info
      const q = getResearchQuestion(doc, questionId);
      if (q && q.searchResults && q.searchResults.length > 0) {
        const updatedResults = [...q.searchResults];
        const lastIdx = updatedResults.length - 1;
        updatedResults[lastIdx] = { ...updatedResults[lastIdx], learned, nextAction: nextStep };
        doc = {
          ...doc,
          questions: doc.questions.map(i =>
            i.id === questionId ? { ...i, searchResults: updatedResults } : i
          ),
        };
      }

      // Save reflection
      doc = addReflectionToResearchQuestion(doc, questionId, cycleNumber, learned, nextStep, status);

      onProgress?.({ type: 'question_reflection', questionId, learned, answerProgress, nextStep, status });
      onProgress?.({ type: 'doc_updated', doc });

      return { learned, answerProgress, nextStep, status };
    }
  });

  // Build context
  const siblingInfo = doc.questions.map((q, i) => {
    const isCurrent = q.id === questionId;
    const statusIcon = q.status === 'done' ? '✓' : q.status === 'running' ? '→' : '○';
    return `${statusIcon} ${i + 1}. ${q.name}${isCurrent ? ' (YOU)' : ''}`;
  }).join('\n');

  const previousQueries = (currentQuestion.searchResults || []).slice(-10).map(sr => `- ${sr.query}`).join('\n') || '(none yet)';

  const systemPrompt = `You are answering a RESEARCH QUESTION through web search.

═══════════════════════════════════════════════════════════════
OBJECTIVE: ${objective}
═══════════════════════════════════════════════════════════════

RESEARCH QUESTIONS:
${siblingInfo}

───────────────────────────────────────────────────────────────
YOUR QUESTION: ${currentQuestion.question}
GOAL: ${currentQuestion.goal}
───────────────────────────────────────────────────────────────

${formatResearchQuestionForAgent(currentQuestion)}

---

WORKFLOW: search → reflect → search → reflect → ... → done

1. SEARCH: Ask ONE clear question (not multiple questions combined)
2. REFLECT: Say what you learned, if we're closer to answering, and what to search next

SEARCH TIPS:
- ONE question per search. Not "What is X and who uses it?" - that's TWO questions.
- Ask like you're talking to a person: "Which podcast networks produce educational content?"
- Not keyword soup: "podcast networks educational content list"

PREVIOUS SEARCHES (don't repeat):
${previousQueries}

WHEN TO STOP (set status="done"):
- Question is sufficiently answered
- No new useful info being found
- Cycle ${cycleNumber}/${currentQuestion.maxCycles} - approaching limit`;

  onProgress?.({
    type: 'question_cycle_started',
    questionId,
    cycle: cycleNumber,
    name: currentQuestion.name,
    goal: currentQuestion.goal
  });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const isFirstCycle = cycleNumber === 1;
  messages.push({
    role: 'user',
    content: isFirstCycle
      ? `Test this hypothesis. First explain your approach briefly, then search.`
      : `Continue testing. Search for more evidence, then reflect.`
  });

  let doneSignaled = false;
  let lastWasSearch = false;

  // Main loop: search → reflect → search → reflect...
  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) {
      log(questionId, `ABORTED at iteration ${i}`);
      break;
    }

    log(questionId, `Iteration ${i + 1}/${maxIterations}`);

    // Alternate tools: after search, only reflect is available
    const reflectOnlyTools = { reflect: reflectTool };
    const allTools = { search, reflect: reflectTool };

    const result = await generateText({
      model,
      system: lastWasSearch
        ? `${systemPrompt}\n\n⚠️ You just searched. Now call reflect to say what you learned.`
        : systemPrompt,
      messages,
      tools: lastWasSearch ? reflectOnlyTools : allTools,
      abortSignal
    });

    trackUsage(result.usage);

    if (!result.toolCalls || result.toolCalls.length === 0) {
      messages.push({ role: 'user', content: 'Use a tool. Either search or reflect.' });
      continue;
    }

    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searchResults = toolOutput.results || [];

        for (const sr of searchResults) {
          queriesExecuted.push(sr.query);
          const sources = sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || [];
          doc = addSearchResultToResearchQuestion(doc, questionId, sr.query, sr.answer || '', sources);
        }

        onProgress?.({
          type: 'question_search_completed',
          questionId,
          queries: searchResults.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });
        onProgress?.({ type: 'doc_updated', doc });

        messages.push({ role: 'assistant', content: `Searched: ${queries.map((q: any) => q.query).join(', ')}` });
        lastWasSearch = true;
        break; // Only process one search per iteration
      }

      if (tc.toolName === 'reflect') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const output = (toolResult as any)?.output || (toolResult as any)?.result || {};

        messages.push({ role: 'assistant', content: `Reflected: ${output.learned}` });
        lastWasSearch = false;

        if (output.status === 'done') {
          doneSignaled = true;
          break;
        }

        messages.push({ role: 'user', content: `Continue. Next: ${output.nextStep}` });
      }
    }

    if (doneSignaled) break;
  }

  // If done, call summarizer
  if (doneSignaled) {
    return await finishQuestion(doc, questionId, abortSignal, onProgress, creditsUsed);
  }

  log(questionId, `──── CYCLE ${cycleNumber} COMPLETE ────`);
  return { doc, shouldContinue: !doneSignaled, queriesExecuted, creditsUsed };
}

/**
 * Finish a question by calling the summarizer
 */
async function finishQuestion(
  doc: CortexDoc,
  questionId: string,
  abortSignal?: AbortSignal,
  onProgress?: (update: any) => void,
  creditsUsed: number = 0
): Promise<ResearchQuestionAgentResult> {
  log(questionId, 'Calling summarize agent...');
  onProgress?.({ type: 'question_summarizing', questionId });

  const summaryResult = await summarizeResearchQuestion({
    doc,
    questionId,
    abortSignal,
    onProgress
  });

  doc = completeResearchQuestion(
    summaryResult.doc,
    questionId,
    summaryResult.summary,
    summaryResult.confidence,
    summaryResult.recommendation
  );

  creditsUsed += summaryResult.creditsUsed;

  onProgress?.({
    type: 'question_completed',
    questionId,
    summary: summaryResult.summary,
    confidence: summaryResult.confidence,
    recommendation: summaryResult.recommendation
  });

  onProgress?.({ type: 'doc_updated', doc });

  return { doc, shouldContinue: false, queriesExecuted: [], creditsUsed };
}

/**
 * Run a full question until completion (multiple cycles)
 */
export async function runResearchQuestionToCompletion(
  config: ResearchQuestionAgentConfig
): Promise<ResearchQuestionAgentResult> {
  let doc = config.doc;
  let totalCreditsUsed = 0;
  const allQueries: string[] = [];

  const question = getResearchQuestion(doc, config.questionId);
  if (!question) {
    return { doc, shouldContinue: false, queriesExecuted: [], creditsUsed: 0 };
  }

  const maxCycles = question.maxCycles;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    if (config.abortSignal?.aborted) break;

    const result = await executeResearchQuestionCycle({
      ...config,
      doc,
    });

    doc = result.doc;
    totalCreditsUsed += result.creditsUsed;
    allQueries.push(...result.queriesExecuted);

    if (!result.shouldContinue) {
      break;
    }
  }

  // If we exhausted cycles without done being called, force completion
  const finalQuestion = getResearchQuestion(doc, config.questionId);
  if (finalQuestion && finalQuestion.status !== 'done') {
    const finishResult = await finishQuestion(doc, config.questionId, config.abortSignal, config.onProgress, 0);
    doc = finishResult.doc;
    totalCreditsUsed += finishResult.creditsUsed;
  }

  return {
    doc,
    shouldContinue: false,
    queriesExecuted: allQueries,
    creditsUsed: totalCreditsUsed
  };
}
