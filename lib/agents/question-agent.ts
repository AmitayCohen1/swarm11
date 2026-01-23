/**
 * ResearchQuestion Agent
 *
 * Runs research→reflect loop for a single question/hypothesis.
 * Each question explores one angle of the research objective.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { CortexDoc, ResearchQuestion } from '@/lib/types/research-question';
import {
  addFindingToResearchQuestion,
  editFindingInResearchQuestion,
  disqualifyFindingInResearchQuestion,
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
  shouldContinue: boolean;  // Whether to continue the question (more cycles)
  queriesExecuted: string[];
  creditsUsed: number;
}

/**
 * Execute a single cycle of research→reflect for an question
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

  // Tool: Add finding to this question
  const addFindingTool = tool({
    description: 'Add a finding to this question. Each finding should be ONE short fact (1-2 lines).',
    inputSchema: z.object({
      content: z.string().describe('The finding - keep it SHORT. Example: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"'),
      sourceUrl: z.string().optional().describe('Source URL if available'),
      sourceTitle: z.string().optional().describe('Source title if available'),
    }),
    execute: async ({ content, sourceUrl, sourceTitle }) => {
      const sources = sourceUrl ? [{ url: sourceUrl, title: sourceTitle || sourceUrl }] : [];
      doc = addFindingToResearchQuestion(doc, questionId, content, sources);
      onProgress?.({ type: 'question_finding_added', questionId, content });
      return { success: true, message: `Added finding` };
    }
  });

  // Tool: Edit existing finding
  const editFindingTool = tool({
    description: 'Edit an existing finding by ID',
    inputSchema: z.object({
      findingId: z.string().describe('The finding ID (f_xxx)'),
      content: z.string().describe('New content for the finding'),
    }),
    execute: async ({ findingId, content }) => {
      doc = editFindingInResearchQuestion(doc, questionId, findingId, content);
      onProgress?.({ type: 'question_finding_edited', questionId, findingId });
      return { success: true, message: `Edited ${findingId}` };
    }
  });

  // Tool: Disqualify finding
  const disqualifyFindingTool = tool({
    description: 'Mark a finding as disqualified/ruled out. Use when info eliminates a candidate.',
    inputSchema: z.object({
      findingId: z.string().describe('The finding ID to disqualify'),
      reason: z.string().describe('Why ruled out (e.g., "Just took new role", "Founded own company")'),
    }),
    execute: async ({ findingId, reason }) => {
      doc = disqualifyFindingInResearchQuestion(doc, questionId, findingId, reason);
      onProgress?.({ type: 'question_finding_disqualified', questionId, findingId, reason });
      return { success: true, message: `Disqualified ${findingId}: ${reason}` };
    }
  });

  // Tool: Search reasoning - explain what was learned and what's next
  const searchReasoningTool = tool({
    description: 'REQUIRED after each search. Explain what you learned and what you will do next.',
    inputSchema: z.object({
      learned: z.string().describe('What did you learn from this search? Be specific and concise.'),
      nextAction: z.string().describe('What will you do next based on this? E.g., "Search for pricing info" or "Add finding about X" or "Done - have enough info"'),
    }),
    execute: async ({ learned, nextAction }) => {
      // Attach reasoning to the most recent search results that don't have reasoning yet
      const init = getResearchQuestion(doc, questionId);
      if (init && init.searchResults) {
        const updatedSearchResults = [...init.searchResults];
        // Find recent results without reasoning and add it
        for (let i = updatedSearchResults.length - 1; i >= 0; i--) {
          if (!updatedSearchResults[i].learned) {
            updatedSearchResults[i] = { ...updatedSearchResults[i], learned, nextAction };
            break; // Only update the most recent
          }
        }
        doc = {
          ...doc,
          questions: doc.questions.map(i =>
            i.id === questionId ? { ...i, searchResults: updatedSearchResults } : i
          ),
        };
      }

      onProgress?.({ type: 'question_search_reasoning', questionId, learned, nextAction });
      onProgress?.({ type: 'doc_updated', doc });

      return { success: true, learned, nextAction };
    }
  });

  // Tool: Reflect - assess progress and decide next steps (can also signal done)
  const reflectTool = tool({
    description: 'Reflect on progress. Set status="done" when research is complete (hypothesis resolved, novelty exhausted, or enough findings).',
    inputSchema: z.object({
      learned: z.string().describe('What you learned this cycle (e.g., "Found 3 podcast agencies with audio content")'),
      nextStep: z.string().describe('What you will do next (e.g., "Will search for pricing info") or why you\'re done (e.g., "Have enough findings to answer the goal")'),
      status: z.enum(['continue', 'done']).describe('continue=keep researching, done=this question is complete'),
      hypothesisStatus: z.enum(['confirming', 'rejecting', 'uncertain']).describe('Is the hypothesis being confirmed or rejected?'),
      noveltyRemaining: z.enum(['high', 'medium', 'low']).describe('How much new info can we still find?'),
      nextSearch: z.string().optional().describe('The ONE next search to run (only if status=continue). Human-readable question. Good: "Which corporate training companies use audio content?" Bad: "corporate training audio companies list"'),
    }),
    execute: async ({ learned, nextStep, status, hypothesisStatus, noveltyRemaining, nextSearch }) => {
      // Save reflection to the question
      doc = addReflectionToResearchQuestion(
        doc,
        questionId,
        cycleNumber,
        learned,
        nextStep,
        status
      );

      onProgress?.({
        type: 'question_reflection',
        questionId,
        learned,
        nextStep,
        status,
        hypothesisStatus,
        noveltyRemaining,
        nextSearch
      });

      // Send doc update so UI shows reflection in real-time
      onProgress?.({ type: 'doc_updated', doc });

      // If done, call the summarize agent to create a comprehensive summary
      if (status === 'done') {
        log(questionId, 'Calling summarize agent...');
        onProgress?.({ type: 'question_summarizing', questionId });

        const summaryResult = await summarizeResearchQuestion({
          doc,
          questionId,
          abortSignal,
          onProgress
        });

        // Update doc with summary results
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

        return {
          learned,
          nextStep,
          status,
          done: true,
          summary: summaryResult.summary,
          confidence: summaryResult.confidence,
          recommendation: summaryResult.recommendation
        };
      }

      return { learned, nextStep, status, hypothesisStatus, noveltyRemaining, nextSearch };
    }
  });

  // Increment cycle counter
  doc = incrementResearchQuestionCycle(doc, questionId);
  const currentResearchQuestion = getResearchQuestion(doc, questionId)!;
  const cycleNumber = currentResearchQuestion.cycles;

  log(questionId, `──── CYCLE ${cycleNumber}/${currentResearchQuestion.maxCycles} START ────`);
  log(questionId, `Name: ${currentResearchQuestion.name}`);
  log(questionId, `Description: ${currentResearchQuestion.description}`);
  log(questionId, `Goal: ${currentResearchQuestion.goal}`);
  log(questionId, `Current findings: ${currentResearchQuestion.findings.length}`);

  // Check if max cycles reached
  if (cycleNumber > currentResearchQuestion.maxCycles) {
    log(questionId, `MAX CYCLES REACHED - calling summarizer`);
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

    return { doc, shouldContinue: false, queriesExecuted, creditsUsed };
  }

  // Get sibling questions for context
  const allResearchQuestions = doc.questions;
  const siblingInfo = allResearchQuestions.map((init, i) => {
    const isCurrent = init.id === questionId;
    const status = init.status === 'done' ? '✓' : init.status === 'running' ? '→' : '○';
    return `${status} ${i + 1}. ${init.name}${isCurrent ? ' (YOU)' : ''}`;
  }).join('\n');

  const systemPrompt = `You are an ResearchQuestion Agent exploring ONE angle of a larger research effort.

═══════════════════════════════════════════════════════════════
OVERALL OBJECTIVE: ${objective}
═══════════════════════════════════════════════════════════════

SUCCESS CRITERIA (for the whole research):
${successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

───────────────────────────────────────────────────────────────
RESEARCH ANGLES (you are ONE of ${allResearchQuestions.length}):
${siblingInfo}
───────────────────────────────────────────────────────────────

YOUR INITIATIVE:
- Name: ${currentResearchQuestion.name}
- Description: ${currentResearchQuestion.description}
- Goal: ${currentResearchQuestion.goal}

Your job: Contribute findings that help achieve the OVERALL OBJECTIVE.
Other questions are exploring different angles. Focus on YOUR angle.

${formatResearchQuestionForAgent(currentResearchQuestion)}

---

YOUR WORKFLOW (search→reason→repeat):
1. SEARCH - run ONE query at a time (not batches)
2. SEARCH_REASONING (required) - explain what you learned and why it matters
3. ADD FINDINGS - capture relevant facts (keep them SHORT)
4. REFLECT - assess progress and decide the next search (or set status="done" to finish)
5. Repeat steps 1-4 until goal achieved or novelty exhausted

CRITICAL: One search at a time. After EVERY search, call search_reasoning before doing anything else.

REFLECT FORMAT - Be clear and concise:
- learned: "Found 3 podcast production companies offering full audio services"
- nextStep: "Will search for pricing and contact info" (or why you're done)
- status: "continue" or "done"

When status="done", a dedicated summarizer will analyze ALL your search results and create a comprehensive summary. You don't need to summarize yourself - just say why you're done.

STOP CONDITIONS (set status="done" when any is true):
- Research question is sufficiently answered
- No new useful information is being found (novelty exhausted)
- You've gathered enough findings (5-10 solid ones)
- Cycle ${cycleNumber}/${currentResearchQuestion.maxCycles} - approaching limit

FINDINGS - BE CONCISE:
GOOD: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"
GOOD: "Pricing: Enterprise plan starts at $500/month"
BAD: "NPR is a large media company that produces podcasts..." (too long)

SEARCH QUERIES - ONE AT A TIME, HUMAN-READABLE:
- Run ONE search, then call search_reasoning, then reflect
- Write queries as questions a person would ask (goes to an LLM)
Good: "Which podcast production companies offer fact-checking services?"
Bad: "podcast fact-checking companies list"

PREVIOUS QUERIES (avoid repeating):
${(currentResearchQuestion.searchResults || []).slice(-10).map(sr => sr.query).join('\n') || '(none)'}`;

  onProgress?.({
    type: 'question_cycle_started',
    questionId,
    cycle: cycleNumber,
    name: currentResearchQuestion.name,
    goal: currentResearchQuestion.goal
  });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Execute cycle ${cycleNumber} for this question. Search for info, add findings, then reflect to decide if more research is needed.`
  });

  let shouldContinue = true;
  let iterationsDone = 0;
  let doneSignaled = false;
  let awaitingReasoning = false; // State: must call search_reasoning next

  // Main loop
  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) {
      log(questionId, `ABORTED at iteration ${i}`);
      break;
    }

    log(questionId, `Iteration ${i + 1}/${maxIterations} - calling LLM...`);

    // After a search, ONLY allow search_reasoning (enforce search → reason flow)
    const allTools = {
      search,
      search_reasoning: searchReasoningTool,
      add_finding: addFindingTool,
      edit_finding: editFindingTool,
      disqualify_finding: disqualifyFindingTool,
      reflect: reflectTool,
    };

    const reasoningOnlyTools = {
      search_reasoning: searchReasoningTool,
    };

    const result = await generateText({
      model,
      system: awaitingReasoning
        ? `${systemPrompt}\n\n⚠️ You just completed a search. You MUST call search_reasoning NOW to explain what you learned.`
        : systemPrompt,
      messages,
      tools: awaitingReasoning ? reasoningOnlyTools : allTools,
      abortSignal
    });

    trackUsage(result.usage);
    iterationsDone++;

    log(questionId, `LLM responded with ${result.toolCalls?.length || 0} tool calls`);

    const assistantActions: string[] = [];
    let reflectionResult: any = null;

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        onProgress?.({ type: 'question_search_started', questionId, queries });

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
          count: searchResults.length,
          queries: searchResults.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });

        // Send doc update so UI shows search results in real-time
        onProgress?.({ type: 'doc_updated', doc });

        assistantActions.push(`Searched: ${queries.map((q: any) => q.query || q).join(', ')}`);

        // After search, MUST call search_reasoning next
        awaitingReasoning = true;

        // IMPORTANT: Break here to ignore any other tool calls in this response
        // This enforces search → reason flow even if LLM tried to call multiple tools
        break;
      }

      if (tc.toolName === 'search_reasoning') {
        assistantActions.push(`Reasoned about search results`);
        // Reasoning done, can proceed with other actions
        awaitingReasoning = false;
      }

      if (tc.toolName === 'add_finding') {
        assistantActions.push(`Added finding`);
      }

      if (tc.toolName === 'edit_finding') {
        assistantActions.push(`Edited ${tc.input?.findingId || tc.args?.findingId}`);
      }

      if (tc.toolName === 'disqualify_finding') {
        const reason = tc.input?.reason || tc.args?.reason || '';
        assistantActions.push(`Disqualified finding: ${reason}`);
      }

      if (tc.toolName === 'reflect') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        reflectionResult = (toolResult as any)?.output || (toolResult as any)?.result || {};
        assistantActions.push(`Reflected: learned="${reflectionResult.learned}", next="${reflectionResult.nextStep}", status=${reflectionResult.status}`);

        // Check if reflect signaled done
        if (reflectionResult.status === 'done' || reflectionResult.done) {
          shouldContinue = false;
          doneSignaled = true;
          assistantActions.push(`ResearchQuestion complete: ${reflectionResult.summary || 'Summarized by dedicated agent'}`);
        }
      }
    }

    // Update conversation
    if (assistantActions.length > 0) {
      log(questionId, `Actions: ${assistantActions.join(' | ')}`);
      messages.push({
        role: 'assistant',
        content: assistantActions.join('\n')
      });
    }

    if (doneSignaled) {
      log(questionId, `DONE signaled - exiting loop`);
      break;
    }

    // Check reflection result for stopping conditions
    if (reflectionResult) {
      const { hypothesisStatus, noveltyRemaining, nextSearch } = reflectionResult;

      // Stop if hypothesis is clearly resolved and novelty is low
      if (
        (hypothesisStatus === 'confirming' || hypothesisStatus === 'rejecting') &&
        noveltyRemaining === 'low'
      ) {
        messages.push({
          role: 'user',
          content: 'Hypothesis appears resolved and novelty is low. Consider calling reflect with status="done" to complete this question.'
        });
      } else if (nextSearch) {
        messages.push({
          role: 'user',
          content: `Continue with next search: ${nextSearch}`
        });
      } else {
        messages.push({
          role: 'user',
          content: 'No next search suggested. If you have enough findings, call reflect with status="done".'
        });
      }
    } else if (awaitingReasoning) {
      // Must call search_reasoning before anything else
      messages.push({
        role: 'user',
        content: 'You just searched. Now call search_reasoning to explain what you learned before continuing.'
      });
    } else if (!result.toolCalls || result.toolCalls.length === 0) {
      // No tool calls - prompt to continue
      messages.push({
        role: 'user',
        content: 'Continue searching and adding findings, or call reflect with status="done" if complete.'
      });
    } else {
      messages.push({
        role: 'user',
        content: 'Continue. Search for more info, add findings, or reflect to assess progress.'
      });
    }
  }

  const finalInit = getResearchQuestion(doc, questionId);
  log(questionId, `──── CYCLE ${cycleNumber} COMPLETE ────`);
  log(questionId, `Stats:`, {
    iterations: iterationsDone,
    queriesExecuted: queriesExecuted.length,
    findings: finalInit?.findings.length || 0,
    shouldContinue: !doneSignaled
  });

  onProgress?.({
    type: 'question_cycle_completed',
    questionId,
    cycle: cycleNumber,
    iterations: iterationsDone,
    queriesExecuted: queriesExecuted.length,
    shouldContinue: !doneSignaled
  });

  return {
    doc,
    shouldContinue: !doneSignaled,
    queriesExecuted,
    creditsUsed
  };
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

  // If we exhausted cycles without done being called, force completion with summarizer
  const finalResearchQuestion = getResearchQuestion(doc, config.questionId);
  if (finalResearchQuestion && finalResearchQuestion.status !== 'done') {
    log(config.questionId, 'Max cycles reached - calling summarizer');
    config.onProgress?.({ type: 'question_summarizing', questionId: config.questionId });

    const summaryResult = await summarizeResearchQuestion({
      doc,
      questionId: config.questionId,
      abortSignal: config.abortSignal,
      onProgress: config.onProgress
    });

    doc = completeResearchQuestion(
      summaryResult.doc,
      config.questionId,
      summaryResult.summary,
      summaryResult.confidence,
      summaryResult.recommendation
    );

    totalCreditsUsed += summaryResult.creditsUsed;

    config.onProgress?.({
      type: 'question_completed',
      questionId: config.questionId,
      summary: summaryResult.summary,
      confidence: summaryResult.confidence,
      recommendation: summaryResult.recommendation
    });

    config.onProgress?.({ type: 'doc_updated', doc });
  }

  return {
    doc,
    shouldContinue: false,
    queriesExecuted: allQueries,
    creditsUsed: totalCreditsUsed
  };
}
