

/**
 * Research Agent - Version 7
 *
 * Unified agent that searches and updates research questions with findings.
 * Uses question-based document structure.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { ResearchDoc } from '@/lib/types/research-doc';
import type { DocEdit } from '@/lib/types/doc-edit';
import {
  applyEdits,
  formatDocForAgent,
  getCurrentStrategy,
  appendStrategy,
  addResearchQuestion,
} from '@/lib/utils/doc-operations';
import type { Strategy } from '@/lib/types/research-doc';

interface ResearchAgentConfig {
  doc: ResearchDoc;
  objective: string;
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ResearchAgentResult {
  doc: ResearchDoc;
  shouldContinue: boolean;
  queriesExecuted: string[];
  creditsUsed: number;
}

/**
 * Unified research agent - searches and updates doc in one loop
 */
export async function executeResearchCycle(config: ResearchAgentConfig): Promise<ResearchAgentResult> {
  const {
    doc: initialDoc,
    objective,
    maxIterations = 10,
    abortSignal,
    onProgress
  } = config;

  const model = openai('gpt-4.1');
  let doc = initialDoc;
  let creditsUsed = 0;
  const queriesExecuted: string[] = [];

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  // Tool: Add a research question
  const addQuestionTool = tool({
    description: 'Add a new research question to investigate. Use when you identify a key question that needs answering.',
    inputSchema: z.object({
      question: z.string().describe('The research question (e.g., "Who are the top DevRel candidates at media companies?")'),
    }),
    execute: async ({ question }) => {
      doc = addResearchQuestion(doc, question);
      const newQuestion = doc.researchQuestions[doc.researchQuestions.length - 1];
      onProgress?.({ type: 'question_added', questionId: newQuestion.id, question });
      return { success: true, questionId: newQuestion.id, message: `Added question: ${question}` };
    }
  });

  // Tool: Add finding to a question
  const addFindingTool = tool({
    description: 'Add a finding/result to a research question. Each finding should be ONE short fact (1-2 lines).',
    inputSchema: z.object({
      questionId: z.string().describe('The question ID (q_xxx) to add the finding to'),
      content: z.string().describe('The finding - keep it SHORT. Example: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"'),
      sourceUrl: z.string().optional().describe('Source URL if available'),
      sourceTitle: z.string().optional().describe('Source title if available'),
    }),
    execute: async ({ questionId, content, sourceUrl, sourceTitle }) => {
      const edit: DocEdit = {
        action: 'add_finding',
        questionId,
        content,
        sources: sourceUrl ? [{ url: sourceUrl, title: sourceTitle || sourceUrl }] : [],
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_added', questionId, content });
      return { success: true, message: `Added finding to ${questionId}` };
    }
  });

  // Tool: Edit existing finding
  const editFindingTool = tool({
    description: 'Edit an existing finding by ID',
    inputSchema: z.object({
      questionId: z.string().describe('The question ID'),
      findingId: z.string().describe('The finding ID (f_xxx)'),
      content: z.string().describe('New content for the finding'),
    }),
    execute: async ({ questionId, findingId, content }) => {
      const edit: DocEdit = {
        action: 'edit_finding',
        questionId,
        findingId,
        content,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_edited', questionId, findingId });
      return { success: true, message: `Edited ${findingId}` };
    }
  });

  // Tool: Remove finding
  const removeFindingTool = tool({
    description: 'Remove a finding by ID',
    inputSchema: z.object({
      questionId: z.string().describe('The question ID'),
      findingId: z.string().describe('The finding ID to remove'),
    }),
    execute: async ({ questionId, findingId }) => {
      const edit: DocEdit = {
        action: 'remove_finding',
        questionId,
        findingId,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_removed', questionId, findingId });
      return { success: true, message: `Removed ${findingId}` };
    }
  });

  // Tool: Disqualify finding (mark as ruled out with reason)
  const disqualifyFindingTool = tool({
    description: 'Mark a finding as disqualified/ruled out. Use when you find info that eliminates a candidate.',
    inputSchema: z.object({
      questionId: z.string().describe('The question ID'),
      findingId: z.string().describe('The finding ID to disqualify'),
      reason: z.string().describe('Why ruled out (e.g., "Just took new role", "Founded own company")'),
    }),
    execute: async ({ questionId, findingId, reason }) => {
      const edit: DocEdit = {
        action: 'disqualify_finding',
        questionId,
        findingId,
        disqualifyReason: reason,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_disqualified', questionId, findingId, reason });
      return { success: true, message: `Disqualified ${findingId}: ${reason}` };
    }
  });

  // Tool: Mark question as done
  const markQuestionDoneTool = tool({
    description: 'Mark a research question as done when you have gathered enough information to answer it.',
    inputSchema: z.object({
      questionId: z.string().describe('The question ID to mark as done'),
    }),
    execute: async ({ questionId }) => {
      const edit: DocEdit = {
        action: 'mark_question_done',
        questionId,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'question_done', questionId });
      return { success: true, message: `Marked ${questionId} as done` };
    }
  });

  // Tool: Update strategy (only when direction meaningfully changes)
  const updateStrategyTool = tool({
    description: 'Update research strategy. ONLY use when direction meaningfully changes (e.g., "Pivoting from media to healthcare"). Do NOT use for minor progress updates.',
    inputSchema: z.object({
      approach: z.string().describe('New research approach'),
      rationale: z.string().describe('Why changing direction'),
      nextActions: z.array(z.string()).describe('1-3 concrete next steps'),
    }),
    execute: async ({ approach, rationale, nextActions }) => {
      const strategy: Strategy = { approach, rationale, nextActions };
      doc = appendStrategy(doc, strategy);
      onProgress?.({ type: 'strategy_updated', approach });
      return { success: true, message: 'Strategy updated' };
    }
  });

  // Tool: Signal done
  const doneTool = tool({
    description: 'Signal that research is complete or you have exhausted useful avenues',
    inputSchema: z.object({
      reason: z.string().describe('Why stopping - what you found or why further research is not productive'),
    }),
    execute: async ({ reason }) => {
      onProgress?.({ type: 'research_cycle_done', reason });
      return { done: true, reason };
    }
  });

  const currentStrategy = getCurrentStrategy(doc);
  const nextAction = currentStrategy?.nextActions[0] || 'Begin research';

  // Check open questions
  const openQuestions = doc.researchQuestions.filter(q => q.status === 'open');
  const doneQuestions = doc.researchQuestions.filter(q => q.status === 'done');
  const questionContext = openQuestions.length > 0
    ? `Open questions (${openQuestions.length}): ${openQuestions.map(q => `[${q.id}] ${q.question}`).join(' | ')}`
    : doneQuestions.length > 0
      ? 'All questions answered!'
      : 'No questions defined';

  const systemPrompt = `You are a Research Agent. You search for information and update the document with findings.

OBJECTIVE: ${objective}

CURRENT TASK: ${nextAction}

${questionContext}

CURRENT DOCUMENT:
${formatDocForAgent(doc)}

---

YOUR WORKFLOW:
1. Pick an open question to work on
2. Search for information to answer it
3. Add findings (short facts) to that question
4. When a question has enough findings (3-5 solid ones), mark it done
5. Move to the next open question
6. Call 'done' when all questions are answered or you've exhausted productive avenues

You can add new questions if you discover important sub-topics not covered by existing questions.

FINDINGS - BE CONCISE:
GOOD: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"
GOOD: "Teladoc | Teri Condon | Chief Compliance Officer"
BAD: "NPR is a large media company that produces podcasts..." (too long)

DISQUALIFICATION - Filter ruthlessly:
- When you find info that rules someone out, use disqualify_finding
- Examples: "Just announced new role", "Founded own company", "Not in target industry"
- Disqualified findings stay visible (crossed out) so you don't re-research them

RULES:
- Each add_finding = ONE specific fact (1-2 lines max)
- Add findings to the appropriate question by questionId
- Mark questions done when sufficiently answered
- Only update strategy when DIRECTION changes

PREVIOUS QUERIES (avoid repeating):
${doc.queriesRun.slice(-15).join('\n') || '(none)'}`;

  onProgress?.({ type: 'research_cycle_started', task: nextAction });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Execute: ${nextAction}\n\nPick an open question, search for information, and add findings. Keep findings SHORT (1-2 lines).`
  });

  let shouldContinue = true;
  let iterationsDone = 0;

  // Main loop
  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        search,
        add_question: addQuestionTool,
        add_finding: addFindingTool,
        edit_finding: editFindingTool,
        remove_finding: removeFindingTool,
        disqualify_finding: disqualifyFindingTool,
        mark_question_done: markQuestionDoneTool,
        update_strategy: updateStrategyTool,
        done: doneTool,
      },
      abortSignal
    });

    trackUsage(result.usage);
    iterationsDone++;

    let doneSignaled = false;
    const assistantActions: string[] = [];

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        onProgress?.({ type: 'search_started', queries });

        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searchResults = toolOutput.results || [];

        for (const sr of searchResults) {
          queriesExecuted.push(sr.query);
          // Add to doc's queriesRun for dedup
          if (!doc.queriesRun.includes(sr.query)) {
            doc = { ...doc, queriesRun: [...doc.queriesRun, sr.query] };
          }
        }

        onProgress?.({
          type: 'search_completed',
          count: searchResults.length,
          queries: searchResults.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });

        assistantActions.push(`Searched: ${queries.map((q: any) => q.query || q).join(', ')}`);
      }

      if (tc.toolName === 'add_question') {
        assistantActions.push(`Added question: ${tc.input?.question || tc.args?.question}`);
      }

      if (tc.toolName === 'add_finding') {
        assistantActions.push(`Added finding to ${tc.input?.questionId || tc.args?.questionId}`);
      }

      if (tc.toolName === 'edit_finding') {
        assistantActions.push(`Edited ${tc.input?.findingId || tc.args?.findingId}`);
      }

      if (tc.toolName === 'remove_finding') {
        assistantActions.push(`Removed ${tc.input?.findingId || tc.args?.findingId}`);
      }

      if (tc.toolName === 'disqualify_finding') {
        const reason = tc.input?.reason || tc.args?.reason || '';
        assistantActions.push(`Disqualified finding: ${reason}`);
      }

      if (tc.toolName === 'mark_question_done') {
        assistantActions.push(`Marked question done: ${tc.input?.questionId || tc.args?.questionId}`);
      }

      if (tc.toolName === 'update_strategy') {
        assistantActions.push(`Updated strategy`);
      }

      if (tc.toolName === 'done') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const doneResult = (toolResult as any)?.output || (toolResult as any)?.result || {};
        shouldContinue = false;
        doneSignaled = true;
        assistantActions.push(`Done: ${doneResult.reason}`);
      }
    }

    // Update conversation
    if (assistantActions.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantActions.join('\n')
      });
    }

    if (doneSignaled) {
      break;
    }

    // If no tool calls, agent is stuck
    if (!result.toolCalls || result.toolCalls.length === 0) {
      messages.push({
        role: 'user',
        content: 'Continue searching and adding findings, or call done if you have enough.'
      });
    } else {
      messages.push({
        role: 'user',
        content: 'Continue. Search for more, add findings, mark questions done, or call done when finished.'
      });
    }
  }

  onProgress?.({
    type: 'research_cycle_completed',
    iterations: iterationsDone,
    queriesExecuted: queriesExecuted.length,
    shouldContinue
  });

  return {
    doc,
    shouldContinue,
    queriesExecuted,
    creditsUsed
  };
}
