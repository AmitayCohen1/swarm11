/**
 * ResearchQuestion Agent - Simplified
 *
 * Clean search → reflect loop. Messages ARE the knowledge.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { CortexDoc } from '@/lib/types/research-question';
import {
  addSearchResultToResearchQuestion,
  addReflectionToResearchQuestion,
  addEpisodeToResearchQuestion,
  getNoDeltaStreak,
  incrementResearchQuestionCycle,
  completeResearchQuestion,
  getResearchQuestion,
} from '@/lib/utils/question-operations';

const log = (questionId: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const shortId = questionId.substring(0, 12);
  console.log(`[Q ${timestamp}] [${shortId}] ${message}`, data ? JSON.stringify(data) : '');
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
 * Run search → reflect loop for one question
 */
export async function runResearchQuestionToCompletion(
  config: ResearchQuestionAgentConfig
): Promise<ResearchQuestionAgentResult> {
  const {
    doc: initialDoc,
    questionId,
    objective,
    maxIterations = 20,
    abortSignal,
    onProgress,
  } = config;

  const model = openai('gpt-5.1');
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

  const previousQueries = (currentQuestion.searchResults || [])
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
3) Repeat

RULES:
- ONE search query at a time
- You MUST reflect after each search (via the reflect tool)
- Don't repeat: ${previousQueries}
- Finish by setting reflect.status="done" (include summary/confidence/recommendation)`;

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

  // Reflect tool (structured episode-like update)
  const reflectTool = tool({
    description: 'Reflect on the most recent search and decide what to do next.',
    inputSchema: z.object({
      deltaType: z.enum(['progress', 'no_change', 'dead_end']).describe('How much did this step change our understanding?'),
      nextStep: z.string().describe('ONE sentence: what to do next, or why you are done.'),
      status: z.enum(['continue', 'done']).describe('continue=keep searching, done=question answered or exhausted'),

      // Required when status="done"
      summary: z.string().optional().describe('Concise final summary for this question (required when done).'),
      confidence: z.enum(['low', 'medium', 'high']).optional().describe('Confidence in this question’s answer (required when done).'),
      recommendation: z.enum(['promising', 'dead_end', 'needs_more']).optional().describe('Usefulness of this research angle (required when done).'),
    }),
    execute: async ({ deltaType, nextStep, status, summary, confidence, recommendation }) => {
      // Patch nextAction into the most recent search result (for UI continuity)
      const q = getResearchQuestion(doc, questionId);
      if (q && q.searchResults && q.searchResults.length > 0) {
        const updatedResults = [...q.searchResults];
        const lastIdx = updatedResults.length - 1;
        updatedResults[lastIdx] = {
          ...updatedResults[lastIdx],
          nextAction: nextStep
        };
        doc = {
          ...doc,
          questions: doc.questions.map(i =>
            i.id === questionId ? { ...i, searchResults: updatedResults } : i
          )
        };
      }

      // Record a structured reflection in the brain (keeps Cortex robust)
      const cycleNumber = getResearchQuestion(doc, questionId)?.cycles || 0;
      doc = addReflectionToResearchQuestion(doc, questionId, cycleNumber, `${deltaType}`, nextStep, status);

      // Add Episode memory (robust unit for Cortex decisions)
      const lastSearch = getResearchQuestion(doc, questionId)?.searchResults?.slice(-1)[0];
      doc = addEpisodeToResearchQuestion(doc, questionId, {
        cycle: cycleNumber,
        query: lastSearch?.query || '',
        purpose: '',
        sources: lastSearch?.sources || [],
        deltaType,
        nextStep,
        status,
      });

      // Anti-loop stop: if consecutive no-delta episodes, force done
      const streak = getNoDeltaStreak(doc, questionId);
      let forcedStop = false;
      if (status !== 'done' && streak >= 2) {
        forcedStop = true;
        status = 'done';
        recommendation = recommendation || 'dead_end';
        confidence = confidence || 'low';
        summary = summary || `Stopped after ${streak} consecutive steps with no new information.`;
      }

      return {
        deltaType,
        nextStep,
        status,
        summary,
        confidence,
        recommendation,
        forcedStop,
        noDeltaStreak: streak
      };
    }
  });

  let done = false;
  let summary = '';
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let recommendation: 'promising' | 'dead_end' | 'needs_more' = 'needs_more';
  let lastWasSearch = false;

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    // If we're about to search, treat this as a new cycle
    if (!lastWasSearch) {
      doc = incrementResearchQuestionCycle(doc, questionId);
    }

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: lastWasSearch ? { reflect: reflectTool } : { search },
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
        lastWasSearch = true;

        // IMPORTANT: the next iteration is reflect-only. We must include the search output in the message context,
        // otherwise reflect will not "see" the results and will correctly claim it has no evidence.
        const sr0 = searchResults?.[0];
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
          forcedStop: output.forcedStop,
          noDeltaStreak: output.noDeltaStreak
        });
        onProgress?.({ type: 'doc_updated', doc });

        // Keep reflection text in the worker's context for continuity
        messages.push({
          role: 'assistant',
          content: `DeltaType: ${deltaType}\nNext: ${nextStep}\nStatus: ${status}`
        });

        lastWasSearch = false;

        if (status === 'done') {
          done = true;
          summary = output.summary || '';
          confidence = output.confidence || 'medium';
          recommendation = output.recommendation || 'needs_more';
        }
      }
    }

    if (done) break;

    // Prompt to continue
    if (!result.toolCalls || result.toolCalls.length === 0) {
      messages.push({ role: 'user', content: lastWasSearch ? 'Use the reflect tool now.' : 'Use the search tool.' });
    } else {
      messages.push({ role: 'user', content: lastWasSearch ? 'Now reflect on what you learned.' : 'Continue searching.' });
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
