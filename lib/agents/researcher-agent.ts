/**
 * Researcher Agent
 *
 * The worker that does the actual web research.
 * Executes one research question via search → reflect loops.
 *
 * MEMORY MODEL:
 * - Appends to question.memory (simple message list)
 * - Three entry types: search, result, reflect
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
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

  // Build context from completed questions (so researcher can build on prior findings)
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

  // Get previous queries to avoid repeating
  const previousQueries = getSearchQueries(doc, questionId);
  const previousQueriesText = previousQueries.length > 0
    ? previousQueries.slice(-10).map(q => `- ${q}`).join('\n')
    : '(none yet)';

  const systemPrompt = `You are researching ONE specific question via web search.

OVERALL OBJECTIVE: ${objective}

ALL QUESTIONS:
${siblingInfo}

YOUR QUESTION: ${currentQuestion.question}
GOAL: ${currentQuestion.goal}${priorKnowledge}

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
- Don't repeat: ${previousQueriesText}
- MINIMUM 4 searches before marking done (unless truly exhausted)
- When reflect.status="done", use the complete tool to summarize findings

REFLECTION STYLE:
Write your thought like you're thinking out loud:
- "Interesting, I found several studios. Let me dig into Gimlet's contact page..."
- "Hmm, that search was too broad. Let me try something more specific..."
- "Good progress! Now I need to find their business development contacts..."
DO NOT write formal task descriptions like "Run a targeted search for X".

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
    description: `Reflect on the most recent search and decide what to do next.

MAIN OBJECTIVE: ${objective}
YOUR QUESTION: ${currentQuestion.question}
YOUR GOAL: ${currentQuestion.goal}

Consider: Does what you found help answer YOUR question? Does it contribute to the MAIN OBJECTIVE?`,
    inputSchema: z.object({
      delta: z.enum(['progress', 'no_change', 'dead_end']).describe('How much did this step help?'),
      thought: z.string().describe('Natural language reflection: "Interesting, I found X... Now let me look for Y" or "Hmm, that didn\'t help much. Let me try Z instead." Think out loud.'),
      status: z.enum(['continue', 'done']).describe('continue=keep searching, done=question answered'),
    }),
    execute: async ({ delta, thought, status: requestedStatus }) => {
      const q = getResearchQuestion(doc, questionId);
      const searchCount = getSearchQueries(doc, questionId).length;

      // Prevent marking done too early
      let status = requestedStatus;
      if (requestedStatus === 'done' && searchCount < MIN_SEARCHES_BEFORE_DONE && delta !== 'dead_end') {
        status = 'continue';
        log(questionId, `Preventing early done - only ${searchCount} searches`);
      }

      // Add reflect to memory
      doc = addReflectToMemory(doc, questionId, thought, delta);

      return { delta, thought, status };
    }
  });

  // Complete tool - generate structured document when done
  const completeTool = tool({
    description: `Complete this research question with a structured document. Call after reflect returns status=done.

MAIN OBJECTIVE: ${objective}
YOUR QUESTION: ${currentQuestion.question}
YOUR GOAL: ${currentQuestion.goal}

Write your answer to help achieve the MAIN OBJECTIVE. Focus on what's useful for the bigger picture.`,
    inputSchema: z.object({
      answer: z.string().describe('Comprehensive answer to the research question (2-3 paragraphs). Be specific with names, numbers, and facts. Frame it in context of the main objective.'),
      keyFindings: z.array(z.string()).describe('3-7 bullet points of the most important facts discovered. Each should be a complete, standalone statement.'),
      sources: z.array(z.object({
        url: z.string(),
        title: z.string(),
        contribution: z.string().describe('What this source contributed (1 sentence)')
      })).describe('Key sources used, with what each contributed'),
      limitations: z.string().optional().describe('What we could NOT find or verify (if any)'),
      confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer quality'),
      recommendation: z.enum(['promising', 'dead_end', 'needs_more']).describe('How useful was this research angle?'),
    }),
    execute: async ({ answer, keyFindings, sources, limitations, confidence, recommendation }) => {
      return { answer, keyFindings, sources, limitations, confidence, recommendation };
    }
  });

  let done = false;
  let needsComplete = false;
  let questionDocument: QuestionDocument | undefined;
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let recommendation: 'promising' | 'dead_end' | 'needs_more' = 'needs_more';
  let lastWasSearch = false;

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
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searches = toolOutput.results || [];

        for (const sr of searches) {
          const query = sr.query;
          const answer = sr.answer || '';
          const sources = sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || [];

          queriesExecuted.push(query);

          // Add to memory: search + result
          doc = addSearchToMemory(doc, questionId, query);
          doc = addResultToMemory(doc, questionId, answer, sources);
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
        const qText = (sr0?.query || '').trim();
        const answer = (sr0?.answer || '').toString().trim();
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
            `Answer:\n${answerBlock}\n` +
            `Sources:\n${topSources || '(none)'}`
        });
      }

      if (tc.toolName === 'reflect') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const output = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const delta = output.delta || 'no_change';
        const thought = output.thought || '';
        const status = output.status || 'continue';

        onProgress?.({
          type: 'question_reflection',
          questionId,
          delta,
          thought,
          status,
        });
        onProgress?.({ type: 'doc_updated', doc });

        messages.push({
          role: 'assistant',
          content: `Thought: ${thought}\nDelta: ${delta}\nStatus: ${status}`
        });

        lastWasSearch = false;

        if (status === 'done') {
          needsComplete = true;
        }
      }

      if (tc.toolName === 'complete') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const output = (toolResult as any)?.output || (toolResult as any)?.result || (tc as any)?.args || {};

        console.log('[complete tool] Raw output:', JSON.stringify(output, null, 2));

        // Build the structured document
        questionDocument = {
          answer: output.answer || 'Research completed.',
          keyFindings: Array.isArray(output.keyFindings) ? output.keyFindings : [],
          sources: Array.isArray(output.sources) ? output.sources : [],
          limitations: output.limitations || undefined,
        };
        confidence = output.confidence || 'medium';
        recommendation = output.recommendation || 'needs_more';
        done = true;

        onProgress?.({
          type: 'question_complete',
          questionId,
          document: questionDocument,
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

  // Complete the question with document
  // Generate a short summary from the answer for backwards compatibility
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
