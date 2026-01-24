/**
 * Researcher Agent
 *
 * The worker that does the actual web research.
 * Executes one research question via search → reflect loops.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { BrainDoc } from '@/lib/types/research-question';
import {
  addSearchToResearchQuestion,
  addReflectionToResearchQuestion,
  addEpisodeToResearchQuestion,
  incrementResearchQuestionCycle,
  completeResearchQuestion,
  getResearchQuestion,
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
    maxIterations = 20,
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

  const previousQueries = (currentQuestion.searches || [])
    .slice(-10)
    .map(sr => `- ${sr.query}`)
    .join('\n') || '(none yet)';

  const systemPrompt = `You are researching ONE specific question via web search.

OVERALL OBJECTIVE: ${objective}

ALL QUESTIONS:
${siblingInfo}

YOUR QUESTION: ${currentQuestion.question}
GOAL: ${currentQuestion.goal}

---

WORKFLOW (STRICT):
1) SEARCH using the search tool (ONE query)
2) REFLECT using the reflect tool (required after every search)
3) Repeat until you have THOROUGHLY explored this question
4) When done, set reflect.status="done", then use COMPLETE to summarize

RULES:
- ONE search query at a time
- Each search query must target ONE thing only (one fact / one entity / one decision)
- You MUST reflect after each search
- Don't repeat: ${previousQueries}
- MINIMUM 4 searches before marking done (unless truly exhausted)
- When reflect.status="done", use the complete tool to summarize findings

DEPTH EXPECTATIONS:
- Don't stop after finding one good result - look for alternatives, verify, cross-reference
- If you found companies/people, search for more details on the top candidates
- If you found a list, dig deeper on 2-3 promising items
- Only mark "done" when you've genuinely exhausted useful angles`;

  onProgress?.({
    type: 'question_started',
    questionId,
    name: currentQuestion.name,
    goal: currentQuestion.goal
  });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Research this question: ${currentQuestion.question}\n\nStart with the most important search.`
  });

  const MIN_SEARCHES_BEFORE_DONE = 4;

  // Reflect tool - analyze what was learned and decide next step
  const reflectTool = tool({
    description: 'Reflect on the most recent search and decide what to do next.',
    inputSchema: z.object({
      deltaType: z.enum(['progress', 'no_change', 'dead_end']).describe('How much did this step change our understanding?'),
      nextStep: z.string().describe('ONE sentence: what to do next, or why you are done.'),
      status: z.enum(['continue', 'done']).describe('continue=keep searching, done=question answered or exhausted'),
    }),
    execute: async ({ deltaType, nextStep, status: requestedStatus }) => {
      const q = getResearchQuestion(doc, questionId);
      const searchCount = q?.searches?.length || 0;

      // Prevent marking done too early unless truly exhausted
      let status = requestedStatus;
      if (requestedStatus === 'done' && searchCount < MIN_SEARCHES_BEFORE_DONE && deltaType !== 'dead_end') {
        status = 'continue';
        log(questionId, `Preventing early done - only ${searchCount} searches, need ${MIN_SEARCHES_BEFORE_DONE}`);
      }
      // Patch nextAction into the most recent search result (for UI continuity)
      const q = getResearchQuestion(doc, questionId);
      if (q && q.searches && q.searches.length > 0) {
        const updatedResults = [...q.searches];
        const lastIdx = updatedResults.length - 1;
        updatedResults[lastIdx] = {
          ...updatedResults[lastIdx],
          nextAction: nextStep
        };
        doc = {
          ...doc,
          questions: doc.questions.map(i =>
            i.id === questionId ? { ...i, searches: updatedResults } : i
          )
        };
      }

      // Record a structured reflection in the brain (keeps Brain robust)
      const cycleNumber = getResearchQuestion(doc, questionId)?.cycles || 0;
      doc = addReflectionToResearchQuestion(doc, questionId, cycleNumber, `${deltaType}`, nextStep, status);

      // Add Episode memory (robust unit for Brain decisions)
      const lastSearch = getResearchQuestion(doc, questionId)?.searches?.slice(-1)[0];
      doc = addEpisodeToResearchQuestion(doc, questionId, {
        cycle: cycleNumber,
        query: lastSearch?.query || '',
        purpose: '',
        sources: lastSearch?.sources || [],
        deltaType,
        nextStep,
        status,
      });

      return { deltaType, nextStep, status };
    }
  });

  // Complete tool - generate final summary when done
  const completeTool = tool({
    description: 'Complete this research question with a final summary. Call this after reflect returns status=done.',
    inputSchema: z.object({
      summary: z.string().describe('Concise final summary of what was learned for this question.'),
      confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer quality.'),
      recommendation: z.enum(['promising', 'dead_end', 'needs_more']).describe('How useful was this research angle?'),
    }),
    execute: async ({ summary, confidence, recommendation }) => {
      return { summary, confidence, recommendation };
    }
  });

  let done = false;
  let needsComplete = false;
  let summary = '';
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let recommendation: 'promising' | 'dead_end' | 'needs_more' = 'needs_more';
  let lastWasSearch = false;

  // All tools available (we control flow via toolChoice)
  const allTools = {
    search,
    reflect: reflectTool,
    complete: completeTool,
  };

  // Determine which tool to force based on state
  const getToolChoice = () => {
    if (needsComplete) return { type: 'tool' as const, toolName: 'complete' as const };
    if (lastWasSearch) return { type: 'tool' as const, toolName: 'reflect' as const };
    return { type: 'tool' as const, toolName: 'search' as const };
  };

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    // If we're about to search, treat this as a new cycle
    if (!lastWasSearch && !needsComplete) {
      doc = incrementResearchQuestionCycle(doc, questionId);
    }

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: allTools,
      toolChoice: getToolChoice(),
      abortSignal
    });

    trackUsage(result.usage);

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searches = toolOutput.results || [];

        for (const sr of searches) {
          queriesExecuted.push(sr.query);
          const sources = sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || [];
          doc = addSearchToResearchQuestion(doc, questionId, sr.query, sr.answer || '', sources);
        }

        onProgress?.({
          type: 'question_search_completed',
          questionId,
          queries: searches.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });
        onProgress?.({ type: 'doc_updated', doc });
        lastWasSearch = true;

        // Include the search output in the message context for reflect
        const sr0 = searches?.[0];
        const qText = (sr0?.query || queries?.[0]?.query || '').trim();
        const answer = (sr0?.answer || '').toString().trim();
        const status = sr0?.status || 'success';
        const err = (sr0?.error || '').toString().trim();
        const topSources = (sr0?.results || [])
          .slice(0, 5)
          .map((r: any) => `- ${r.title ? `${r.title} — ` : ''}${r.url}`)
          .join('\n');

        const answerBlock = answer ? (answer.length > 1200 ? `${answer.slice(0, 1200)}…` : answer) : '(no answer)';

        messages.push({
          role: 'assistant',
          content:
            `SEARCH RESULTS\n` +
            `${qText ? `Query: ${qText}\n` : ''}` +
            `Status: ${status}\n` +
            `${err ? `Error: ${err}\n` : ''}` +
            `Answer:\n${answerBlock}\n` +
            `Sources:\n${topSources || '(none)'}`
        });
      }

      if (tc.toolName === 'reflect') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const output = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const deltaType = output.deltaType || 'no_change';
        const nextStep = output.nextStep || '';
        const status = output.status || 'continue';

        onProgress?.({
          type: 'question_reflection',
          questionId,
          deltaType,
          nextStep,
          status,
        });
        onProgress?.({ type: 'doc_updated', doc });

        messages.push({
          role: 'assistant',
          content: `DeltaType: ${deltaType}\nNext: ${nextStep}\nStatus: ${status}`
        });

        lastWasSearch = false;

        if (status === 'done') {
          needsComplete = true;
        }
      }

      if (tc.toolName === 'complete') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const output = (toolResult as any)?.output || (toolResult as any)?.result || {};

        summary = output.summary || '';
        confidence = output.confidence || 'medium';
        recommendation = output.recommendation || 'needs_more';
        done = true;

        onProgress?.({
          type: 'question_complete',
          questionId,
          summary,
          confidence,
          recommendation,
        });
        onProgress?.({ type: 'doc_updated', doc });
      }
    }

    if (done) break;

    // Add continuation prompt only if no tool was called
    if (!result.toolCalls || result.toolCalls.length === 0) {
      messages.push({ role: 'user', content: 'Continue with the next step.' });
    }
  }

  // Complete the question
  doc = completeResearchQuestion(doc, questionId, summary, confidence, recommendation);

  onProgress?.({
    type: 'question_completed',
    questionId,
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
