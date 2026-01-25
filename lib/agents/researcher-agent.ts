/**
 * Researcher Agent
 *
 * The worker that does the actual web research.
 * Executes one research question via search → reflect loops.
 *
 * ARCHITECTURE:
 * - Search = tool (calls Tavily API)
 * - Reflect = LLM call with structured output (no tool)
 * - Complete = LLM call with structured output (no tool)
 *
 * This separation makes the flow predictable and avoids toolChoice issues.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/perplexity-search';
import type { BrainDoc, QuestionDocument } from '@/lib/types/research-question';
import {
  addSearchToMemory,
  addResultToMemory,
  addReflectToMemory,
  incrementResearchQuestionCycle,
  completeResearchQuestion,
  getResearchQuestion,
  getSearchQueries,
} from '@/lib/utils/question-operations';

const log = (questionId: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const shortId = questionId.substring(0, 12);
  console.log(`[Q ${timestamp}] [${shortId}] ${message}`, data ? JSON.stringify(data) : '');
};

interface ResearcherAgentConfig {
  doc: BrainDoc;
  questionId: string;
  objective: string;
  successCriteria: string[];
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ResearcherAgentResult {
  doc: BrainDoc;
  shouldContinue: boolean;
  queriesExecuted: string[];
  creditsUsed: number;
}

// Schema for reflection step
const ReflectionSchema = z.object({
  delta: z.enum(['progress', 'no_change', 'dead_end']).describe('How much did this search help?'),
  thought: z.string().describe('Natural reflection: "Interesting, I found X... Now let me look for Y"'),
  status: z.enum(['continue', 'done']).describe('continue = keep searching, done = question answered'),
});

/**
 * Run search → reflect loop for one question
 */
export async function runResearchQuestionToCompletion(
  config: ResearcherAgentConfig
): Promise<ResearcherAgentResult> {
  const {
    doc: initialDoc,
    questionId,
    objective,
    maxIterations = 30,
    abortSignal,
    onProgress,
  } = config;

  const model = openai('gpt-5.2');
  let doc = initialDoc;
  let creditsUsed = 0;
  const queriesExecuted: string[] = [];

  const question = getResearchQuestion(doc, questionId);
  if (!question) {
    return { doc, shouldContinue: false, queriesExecuted, creditsUsed };
  }

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  const currentQuestion = getResearchQuestion(doc, questionId)!;
  log(questionId, `Starting: ${currentQuestion.name}`);

  // Build context from sibling questions
  const siblingInfo = doc.questions.map((q, i) => {
    const isCurrent = q.id === questionId;
    const icon = q.status === 'done' ? '✓' : q.status === 'running' ? '→' : '○';
    return `${icon} ${i + 1}. ${q.name}${isCurrent ? ' ← YOU' : ''}`;
  }).join('\n');

  // Build context from completed questions
  const completedDocs = doc.questions
    .filter(q => q.status === 'done' && q.document && q.id !== questionId)
    .map(q => {
      const findings = q.document!.keyFindings.slice(0, 5).map(f => `  • ${f}`).join('\n');
      return `### ${q.name}\n**Answer:** ${q.document!.answer.slice(0, 500)}${q.document!.answer.length > 500 ? '...' : ''}\n**Key Findings:**\n${findings}`;
    })
    .join('\n\n');

  const priorKnowledge = completedDocs
    ? `\n\n---\n\nPRIOR RESEARCH (build on this, don't duplicate):\n${completedDocs}`
    : '';

  const MIN_SEARCHES_BEFORE_DONE = 4;

  onProgress?.({
    type: 'question_started',
    questionId,
    name: currentQuestion.name,
    goal: currentQuestion.goal
  });

  // Accumulate search history for context
  const searchHistory: Array<{ query: string; answer: string; sources: string[] }> = [];

  let questionDocument: QuestionDocument | undefined;
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let recommendation: 'promising' | 'dead_end' | 'needs_more' = 'needs_more';

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    doc = incrementResearchQuestionCycle(doc, questionId);

    // Get previous queries to avoid repeating
    const previousQueries = getSearchQueries(doc, questionId);
    const previousQueriesText = previousQueries.length > 0
      ? previousQueries.slice(-10).map(q => `- ${q}`).join('\n')
      : '(none yet)';

    // Build search history context
    const historyContext = searchHistory.map((h, idx) =>
      `Search ${idx + 1}: "${h.query}"\nResult: ${h.answer.substring(0, 500)}${h.answer.length > 500 ? '...' : ''}`
    ).join('\n\n');

    // ============ STEP 1: SEARCH ============
    const searchPrompt = `You are researching: ${currentQuestion.question}
GOAL: ${currentQuestion.goal}

OVERALL OBJECTIVE: ${objective}

ALL QUESTIONS:
${siblingInfo}
${priorKnowledge}

${historyContext ? `\nPREVIOUS SEARCHES:\n${historyContext}\n` : ''}

Don't repeat these queries:
${previousQueriesText}

USE THE SEARCH TOOL NOW. Provide:
- query: A focused question about ONE specific topic (not multiple topics combined)
- purpose: Why you need this information

Keep queries focused - one topic per search. You can do multiple searches.`;

    log(questionId, `Cycle ${i + 1}: Searching...`);

    const searchResult = await generateText({
      model,
      prompt: searchPrompt,
      tools: { search },
      toolChoice: 'required',
      abortSignal
    });

    trackUsage(searchResult.usage);

    // Extract search results
    let searchQuery = '';
    let searchAnswer = '';
    let searchSources: Array<{ url: string; title: string }> = [];

    for (const toolCall of searchResult.toolCalls || []) {
      const tc = toolCall as any;
      if (tc.toolName === 'search') {
        // Get the result from tool execution
        const toolResultObj = searchResult.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId) as any;

        // Debug logging - show full structure
        console.log('[Researcher] toolResultObj:', JSON.stringify(toolResultObj, null, 2)?.substring(0, 2000));
        console.log('[Researcher] tc (toolCall):', JSON.stringify(tc, null, 2)?.substring(0, 500));

        // Input can be in tc.input (Anthropic) or tc.args (OpenAI) or toolResultObj.input
        const toolInput = tc.input?.queries?.[0] || tc.args?.queries?.[0] || toolResultObj?.input?.queries?.[0] || {};
        const inputQuery = toolInput.query || '';

        // The tool result structure varies by provider:
        // - Anthropic: { output: { count, results: [...] } }
        // - OpenAI: { result: { count, results: [...] } }
        // Try all possible paths
        const toolOutput = toolResultObj?.output || toolResultObj?.result || toolResultObj || {};
        const searches = toolOutput.results || [];

        console.log('[Researcher] Extracted - toolOutput keys:', Object.keys(toolOutput));
        console.log('[Researcher] Extracted - searches count:', searches.length);
        if (searches[0]) {
          console.log('[Researcher] Extracted - answer length:', searches[0].answer?.length || 0);
        }

        // Get query and answer from search results
        const sr = searches[0] || {};
        searchQuery = sr.query || inputQuery || '';
        searchAnswer = sr.answer || '';
        searchSources = sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || [];

        log(questionId, `Search executed: "${searchQuery.substring(0, 80)}..."`);

        if (searchQuery) {
          queriesExecuted.push(searchQuery);
          doc = addSearchToMemory(doc, questionId, searchQuery);
          doc = addResultToMemory(doc, questionId, searchAnswer, searchSources);
        }

        onProgress?.({
          type: 'question_search_completed',
          questionId,
          queries: [{
            query: searchQuery,
            answer: searchAnswer,
            sources: searchSources
          }]
        });
        onProgress?.({ type: 'doc_updated', doc });
      }
    }

    // Add to history
    searchHistory.push({
      query: searchQuery,
      answer: searchAnswer,
      sources: searchSources.map(s => s.url)
    });

    log(questionId, `Search: "${searchQuery.substring(0, 50)}..."`);
    log(questionId, `Search answer length: ${searchAnswer.length}, first 200 chars: ${searchAnswer.substring(0, 200)}`);

    // ============ STEP 2: REFLECT ============
    const reflectPrompt = `You just searched for: "${searchQuery}"

Result:
${searchAnswer || '(no answer returned)'}

Sources:
${searchSources.map(s => `- ${s.title || s.url}`).join('\n') || '(none)'}

---

YOUR QUESTION: ${currentQuestion.question}
YOUR GOAL: ${currentQuestion.goal}
MAIN OBJECTIVE: ${objective}

Searches so far: ${queriesExecuted.length}

Reflect on what you learned. Think out loud like:
- "Interesting, I found X... Now let me look for Y"
- "Hmm, that didn't help much. Let me try Z instead"
- "Good progress! I now know A, B, C. Still need to find D"

If you've done at least ${MIN_SEARCHES_BEFORE_DONE} searches AND have enough info to answer the question, set status to "done".`;

    log(questionId, `Cycle ${i + 1}: Reflecting...`);

    const reflectResult = await generateText({
      model,
      prompt: reflectPrompt,
      output: Output.object({ schema: ReflectionSchema }),
      abortSignal
    });

    trackUsage(reflectResult.usage);

    const reflectData = reflectResult.object as z.infer<typeof ReflectionSchema>;
    let { delta, thought, status } = reflectData;

    // Prevent marking done too early
    if (status === 'done' && queriesExecuted.length < MIN_SEARCHES_BEFORE_DONE && delta !== 'dead_end') {
      status = 'continue';
      log(questionId, `Preventing early done - only ${queriesExecuted.length} searches`);
    }

    doc = addReflectToMemory(doc, questionId, thought, delta);

    onProgress?.({
      type: 'question_reflection',
      questionId,
      delta,
      thought,
      status,
    });
    onProgress?.({ type: 'doc_updated', doc });

    log(questionId, `Reflect: ${delta} - "${thought.substring(0, 50)}..." → ${status}`);

    // ============ STEP 3: COMPLETE (if done) ============
    if (status === 'done') {
      const completePrompt = `You've finished researching this question. Now summarize your findings.

YOUR QUESTION: ${currentQuestion.question}
YOUR GOAL: ${currentQuestion.goal}
MAIN OBJECTIVE: ${objective}

SEARCH HISTORY:
${searchHistory.map((h, idx) =>
  `${idx + 1}. Query: "${h.query}"\n   Result: ${h.answer.substring(0, 300)}${h.answer.length > 300 ? '...' : ''}\n   Sources: ${h.sources.slice(0, 3).join(', ')}`
).join('\n\n')}

Write a comprehensive answer in markdown.
Include key findings, sources, and any limitations.`;

      log(questionId, `Completing...`);

      const completeResult = await generateText({
        model,
        prompt: completePrompt,
        abortSignal
      });

      trackUsage(completeResult.usage);

      // Just use the markdown response directly
      questionDocument = {
        answer: completeResult.text,
        keyFindings: [],
        sources: [],
        limitations: '',
      };
      confidence = 'medium';
      recommendation = 'promising';

      onProgress?.({
        type: 'question_complete',
        questionId,
        document: questionDocument,
        confidence,
        recommendation,
      });
      onProgress?.({ type: 'doc_updated', doc });

      break; // Exit loop
    }
  }

  // Complete the question with document
  const answerText = questionDocument?.answer || '';
  const summary = answerText ? (answerText.substring(0, 200) + (answerText.length > 200 ? '...' : '')) : '';
  doc = completeResearchQuestion(doc, questionId, summary, confidence, recommendation, questionDocument);

  onProgress?.({
    type: 'question_completed',
    questionId,
    document: questionDocument,
    summary,
    confidence,
    recommendation
  });
  onProgress?.({ type: 'doc_updated', doc });

  log(questionId, `Complete: ${queriesExecuted.length} searches, ${confidence} confidence`);

  return {
    doc,
    shouldContinue: false,
    queriesExecuted,
    creditsUsed
  };
}
