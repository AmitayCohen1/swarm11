

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
  getCurrentPhase,
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

  // Tool: Add a new phase (when discovering new areas to research)
  const addPhaseTool = tool({
    description: 'Add a new research phase to the plan. Use when you discover a new area that needs investigation.',
    inputSchema: z.object({
      title: z.string().describe('Phase title (e.g., "Research pricing strategies")'),
      goal: z.string().describe('What we want to learn in this phase'),
    }),
    execute: async ({ title, goal }) => {
      const edit: DocEdit = {
        action: 'add_phase',
        phaseTitle: title,
        phaseGoal: goal,
      };
      doc = applyEdits(doc, [edit]);
      const newPhase = doc.phases[doc.phases.length - 1];
      onProgress?.({ type: 'phase_added', phaseId: newPhase.id, title });
      return { success: true, phaseId: newPhase.id, message: `Added phase: ${title}` };
    }
  });

  // Tool: Add finding to a phase
  const addFindingTool = tool({
    description: 'Add a finding/result to the current phase. Each finding should be ONE short fact (1-2 lines).',
    inputSchema: z.object({
      phaseId: z.string().describe('The phase ID (phase_xxx) to add the finding to'),
      content: z.string().describe('The finding - keep it SHORT. Example: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"'),
      sourceUrl: z.string().optional().describe('Source URL if available'),
      sourceTitle: z.string().optional().describe('Source title if available'),
    }),
    execute: async ({ phaseId, content, sourceUrl, sourceTitle }) => {
      const edit: DocEdit = {
        action: 'add_finding',
        phaseId,
        content,
        sources: sourceUrl ? [{ url: sourceUrl, title: sourceTitle || sourceUrl }] : [],
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_added', phaseId, content });
      return { success: true, message: `Added finding to ${phaseId}` };
    }
  });

  // Tool: Edit existing finding
  const editFindingTool = tool({
    description: 'Edit an existing finding by ID',
    inputSchema: z.object({
      phaseId: z.string().describe('The phase ID'),
      findingId: z.string().describe('The finding ID (f_xxx)'),
      content: z.string().describe('New content for the finding'),
    }),
    execute: async ({ phaseId, findingId, content }) => {
      const edit: DocEdit = {
        action: 'edit_finding',
        phaseId,
        findingId,
        content,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_edited', phaseId, findingId });
      return { success: true, message: `Edited ${findingId}` };
    }
  });

  // Tool: Remove finding
  const removeFindingTool = tool({
    description: 'Remove a finding by ID',
    inputSchema: z.object({
      phaseId: z.string().describe('The phase ID'),
      findingId: z.string().describe('The finding ID to remove'),
    }),
    execute: async ({ phaseId, findingId }) => {
      const edit: DocEdit = {
        action: 'remove_finding',
        phaseId,
        findingId,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_removed', phaseId, findingId });
      return { success: true, message: `Removed ${findingId}` };
    }
  });

  // Tool: Disqualify finding (mark as ruled out with reason)
  const disqualifyFindingTool = tool({
    description: 'Mark a finding as disqualified/ruled out. Use when you find info that eliminates a candidate.',
    inputSchema: z.object({
      phaseId: z.string().describe('The phase ID'),
      findingId: z.string().describe('The finding ID to disqualify'),
      reason: z.string().describe('Why ruled out (e.g., "Just took new role", "Founded own company")'),
    }),
    execute: async ({ phaseId, findingId, reason }) => {
      const edit: DocEdit = {
        action: 'disqualify_finding',
        phaseId,
        findingId,
        disqualifyReason: reason,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'finding_disqualified', phaseId, findingId, reason });
      return { success: true, message: `Disqualified ${findingId}: ${reason}` };
    }
  });

  // Tool: Complete current phase and move to next
  const completePhaseTool = tool({
    description: 'Mark the current phase as done when you have gathered enough findings. This auto-starts the next phase.',
    inputSchema: z.object({
      phaseId: z.string().describe('The phase ID to mark as done'),
    }),
    execute: async ({ phaseId }) => {
      const edit: DocEdit = {
        action: 'complete_phase',
        phaseId,
      };
      doc = applyEdits(doc, [edit]);
      onProgress?.({ type: 'phase_completed', phaseId });
      return { success: true, message: `Completed ${phaseId}, next phase started` };
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

  // Check current phase
  const currentPhase = getCurrentPhase(doc);
  const donePhases = doc.phases.filter(p => p.status === 'done');
  const remainingPhases = doc.phases.filter(p => p.status !== 'done');
  const phaseContext = currentPhase
    ? `CURRENT PHASE: [${currentPhase.id}] ${currentPhase.title}\nGoal: ${currentPhase.goal}`
    : remainingPhases.length === 0 && donePhases.length > 0
      ? 'All phases completed!'
      : 'No phases defined';

  const systemPrompt = `You are a Research Agent. You search for information and update the document with findings.

OBJECTIVE: ${objective}

CURRENT TASK: ${nextAction}

${phaseContext}

CURRENT DOCUMENT:
${formatDocForAgent(doc)}

---

YOUR WORKFLOW:
1. Focus on the CURRENT PHASE - work through phases in order
2. Search for information related to the current phase's goal
3. Add findings (short facts) to the current phase
4. When a phase has enough findings (3-5 solid ones), complete it
5. The next phase will auto-start
6. Call 'done' when all phases are completed or you've exhausted productive avenues

You can add new phases if you discover important areas not covered by the existing plan.

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
- Add findings to the current phase by phaseId
- Complete phases when sufficiently researched
- Only update strategy when DIRECTION changes

PREVIOUS QUERIES (avoid repeating):
${doc.queriesRun.slice(-15).join('\n') || '(none)'}`;

  onProgress?.({ type: 'research_cycle_started', task: nextAction });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Execute: ${nextAction}\n\nWork on the current phase. Search for information, and add findings. Keep findings SHORT (1-2 lines).`
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
        add_phase: addPhaseTool,
        add_finding: addFindingTool,
        edit_finding: editFindingTool,
        remove_finding: removeFindingTool,
        disqualify_finding: disqualifyFindingTool,
        complete_phase: completePhaseTool,
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

      if (tc.toolName === 'add_phase') {
        assistantActions.push(`Added phase: ${tc.input?.title || tc.args?.title}`);
      }

      if (tc.toolName === 'add_finding') {
        assistantActions.push(`Added finding to ${tc.input?.phaseId || tc.args?.phaseId}`);
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

      if (tc.toolName === 'complete_phase') {
        assistantActions.push(`Completed phase: ${tc.input?.phaseId || tc.args?.phaseId}`);
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
        content: 'Continue. Search for more, add findings, complete phases when ready, or call done when finished.'
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
