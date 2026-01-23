/**
 * Initiative Agent
 *
 * Runs research→reflect loop for a single initiative/hypothesis.
 * Each initiative explores one angle of the research objective.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import type { CortexDoc, Initiative } from '@/lib/types/initiative-doc';
import {
  addFindingToInitiative,
  editFindingInInitiative,
  disqualifyFindingInInitiative,
  addQueryToInitiative,
  addSearchResultToInitiative,
  addReflectionToInitiative,
  incrementInitiativeCycle,
  completeInitiative,
  formatInitiativeForAgent,
  getInitiative,
} from '@/lib/utils/initiative-operations';

// Logging helper
const log = (initiativeId: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const shortId = initiativeId.substring(0, 12);
  const prefix = `[Initiative ${timestamp}] [${shortId}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
};

interface InitiativeAgentConfig {
  doc: CortexDoc;
  initiativeId: string;
  objective: string;
  successCriteria: string[];
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface InitiativeAgentResult {
  doc: CortexDoc;
  shouldContinue: boolean;  // Whether to continue the initiative (more cycles)
  queriesExecuted: string[];
  creditsUsed: number;
}

/**
 * Execute a single cycle of research→reflect for an initiative
 */
export async function executeInitiativeCycle(
  config: InitiativeAgentConfig
): Promise<InitiativeAgentResult> {
  const {
    doc: initialDoc,
    initiativeId,
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

  const initiative = getInitiative(doc, initiativeId);
  if (!initiative) {
    console.warn(`[InitiativeAgent] Initiative ${initiativeId} not found`);
    return { doc, shouldContinue: false, queriesExecuted, creditsUsed };
  }

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  // Tool: Add finding to this initiative
  const addFindingTool = tool({
    description: 'Add a finding to this initiative. Each finding should be ONE short fact (1-2 lines).',
    inputSchema: z.object({
      content: z.string().describe('The finding - keep it SHORT. Example: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"'),
      sourceUrl: z.string().optional().describe('Source URL if available'),
      sourceTitle: z.string().optional().describe('Source title if available'),
    }),
    execute: async ({ content, sourceUrl, sourceTitle }) => {
      const sources = sourceUrl ? [{ url: sourceUrl, title: sourceTitle || sourceUrl }] : [];
      doc = addFindingToInitiative(doc, initiativeId, content, sources);
      onProgress?.({ type: 'initiative_finding_added', initiativeId, content });
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
      doc = editFindingInInitiative(doc, initiativeId, findingId, content);
      onProgress?.({ type: 'initiative_finding_edited', initiativeId, findingId });
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
      doc = disqualifyFindingInInitiative(doc, initiativeId, findingId, reason);
      onProgress?.({ type: 'initiative_finding_disqualified', initiativeId, findingId, reason });
      return { success: true, message: `Disqualified ${findingId}: ${reason}` };
    }
  });

  // Tool: Reflect - assess progress and decide next steps
  const reflectTool = tool({
    description: 'Reflect on progress. Summarize what you learned and what you will do next.',
    inputSchema: z.object({
      learned: z.string().describe('What you learned this cycle (e.g., "Found 3 podcast agencies with audio content")'),
      nextStep: z.string().describe('What you will do next (e.g., "Will search for pricing info") or "Have enough findings, finishing"'),
      hypothesisStatus: z.enum(['confirming', 'rejecting', 'uncertain']).describe('Is the hypothesis being confirmed or rejected?'),
      noveltyRemaining: z.enum(['high', 'medium', 'low']).describe('How much new info can we still find?'),
      nextSearches: z.array(z.string()).max(3).describe('0-3 specific searches to run next (empty if done)'),
    }),
    execute: async ({ learned, nextStep, hypothesisStatus, noveltyRemaining, nextSearches }) => {
      const shouldContinue = nextSearches.length > 0 && noveltyRemaining !== 'low';

      // Save reflection to the initiative
      doc = addReflectionToInitiative(
        doc,
        initiativeId,
        cycleNumber,
        learned,
        nextStep,
        shouldContinue ? 'continue' : 'done'
      );

      onProgress?.({
        type: 'initiative_reflection',
        initiativeId,
        learned,
        nextStep,
        hypothesisStatus,
        noveltyRemaining,
        nextSearches
      });
      return { learned, nextStep, hypothesisStatus, noveltyRemaining, nextSearches };
    }
  });

  // Tool: Done - signal initiative is complete
  const doneTool = tool({
    description: 'Signal that this initiative is complete. Use when: hypothesis confirmed/rejected, novelty exhausted, or max cycles reached.',
    inputSchema: z.object({
      summary: z.string().describe('Summary of what was found'),
      confidence: z.enum(['low', 'medium', 'high']).describe('How confident are we in the findings?'),
      recommendation: z.enum(['promising', 'dead_end', 'needs_more']).describe('Should cortex pursue this angle further?'),
    }),
    execute: async ({ summary, confidence, recommendation }) => {
      doc = completeInitiative(doc, initiativeId, summary, confidence, recommendation);
      onProgress?.({
        type: 'initiative_completed',
        initiativeId,
        summary,
        confidence,
        recommendation
      });
      return { done: true, summary, confidence, recommendation };
    }
  });

  // Increment cycle counter
  doc = incrementInitiativeCycle(doc, initiativeId);
  const currentInitiative = getInitiative(doc, initiativeId)!;
  const cycleNumber = currentInitiative.cycles;

  log(initiativeId, `──── CYCLE ${cycleNumber}/${currentInitiative.maxCycles} START ────`);
  log(initiativeId, `Angle: ${currentInitiative.angle}`);
  log(initiativeId, `Rationale: ${currentInitiative.rationale}`);
  log(initiativeId, `Question: ${currentInitiative.question}`);
  log(initiativeId, `Current findings: ${currentInitiative.findings.length}`);

  // Check if max cycles reached
  if (cycleNumber > currentInitiative.maxCycles) {
    log(initiativeId, `MAX CYCLES REACHED - forcing completion`);
    doc = completeInitiative(
      doc,
      initiativeId,
      'Max cycles reached - stopping',
      'low',
      'needs_more'
    );
    return { doc, shouldContinue: false, queriesExecuted, creditsUsed };
  }

  const systemPrompt = `You are an Initiative Agent exploring ONE research angle.

OVERALL OBJECTIVE: ${objective}

SUCCESS CRITERIA:
${successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

YOUR RESEARCH ANGLE:
- Angle: ${currentInitiative.angle}
- Rationale: ${currentInitiative.rationale}
- Question: ${currentInitiative.question}

${formatInitiativeForAgent(currentInitiative)}

---

YOUR WORKFLOW (research→reflect loop):
1. SEARCH for information to answer your research question
2. ADD FINDINGS as you discover relevant facts (keep them SHORT - 1-2 lines)
3. REFLECT to share what you learned and what you'll do next
4. DONE when: question answered, novelty exhausted, or you have enough findings

REFLECT FORMAT - Be clear and concise:
- learned: "Found 3 podcast production companies offering full audio services"
- nextStep: "Will search for pricing and contact info" or "Have enough, finishing"

STOP CONDITIONS (call done when any is true):
- Research question is sufficiently answered
- No new useful information is being found (novelty exhausted)
- You've gathered enough findings (5-10 solid ones)
- Cycle ${cycleNumber}/${currentInitiative.maxCycles} - approaching limit

FINDINGS - BE CONCISE:
GOOD: "NPR | Collin Campbell | SVP Podcasting | linkedin.com/in/collin"
GOOD: "Pricing: Enterprise plan starts at $500/month"
BAD: "NPR is a large media company that produces podcasts..." (too long)

PREVIOUS QUERIES (avoid repeating):
${currentInitiative.queriesRun.slice(-10).join('\n') || '(none)'}`;

  onProgress?.({
    type: 'initiative_cycle_started',
    initiativeId,
    cycle: cycleNumber,
    angle: currentInitiative.angle,
    question: currentInitiative.question
  });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Execute cycle ${cycleNumber} for this initiative. Search for info, add findings, then reflect to decide if more research is needed.`
  });

  let shouldContinue = true;
  let iterationsDone = 0;
  let doneSignaled = false;

  // Main loop
  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) {
      log(initiativeId, `ABORTED at iteration ${i}`);
      break;
    }

    log(initiativeId, `Iteration ${i + 1}/${maxIterations} - calling LLM...`);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        search,
        add_finding: addFindingTool,
        edit_finding: editFindingTool,
        disqualify_finding: disqualifyFindingTool,
        reflect: reflectTool,
        done: doneTool,
      },
      abortSignal
    });

    trackUsage(result.usage);
    iterationsDone++;

    log(initiativeId, `LLM responded with ${result.toolCalls?.length || 0} tool calls`);

    const assistantActions: string[] = [];
    let reflectionResult: any = null;

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        onProgress?.({ type: 'initiative_search_started', initiativeId, queries });

        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searchResults = toolOutput.results || [];

        for (const sr of searchResults) {
          queriesExecuted.push(sr.query);
          const sources = sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || [];
          doc = addSearchResultToInitiative(doc, initiativeId, sr.query, sr.answer || '', sources);
        }

        onProgress?.({
          type: 'initiative_search_completed',
          initiativeId,
          count: searchResults.length,
          queries: searchResults.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });

        assistantActions.push(`Searched: ${queries.map((q: any) => q.query || q).join(', ')}`);
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
        assistantActions.push(`Reflected: learned="${reflectionResult.learned}", next="${reflectionResult.nextStep}"`);
      }

      if (tc.toolName === 'done') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const doneResult = (toolResult as any)?.output || (toolResult as any)?.result || {};
        shouldContinue = false;
        doneSignaled = true;
        assistantActions.push(`Done: ${doneResult.summary}`);
      }
    }

    // Update conversation
    if (assistantActions.length > 0) {
      log(initiativeId, `Actions: ${assistantActions.join(' | ')}`);
      messages.push({
        role: 'assistant',
        content: assistantActions.join('\n')
      });
    }

    if (doneSignaled) {
      log(initiativeId, `DONE signaled - exiting loop`);
      break;
    }

    // Check reflection result for stopping conditions
    if (reflectionResult) {
      const { hypothesisStatus, noveltyRemaining, nextSearches } = reflectionResult;

      // Stop if hypothesis is clearly resolved and novelty is low
      if (
        (hypothesisStatus === 'confirming' || hypothesisStatus === 'rejecting') &&
        noveltyRemaining === 'low'
      ) {
        messages.push({
          role: 'user',
          content: 'Hypothesis appears resolved and novelty is low. Consider calling done to complete this initiative.'
        });
      } else if (nextSearches && nextSearches.length > 0) {
        messages.push({
          role: 'user',
          content: `Continue with next searches: ${nextSearches.join(', ')}`
        });
      } else if (nextSearches && nextSearches.length === 0) {
        messages.push({
          role: 'user',
          content: 'No more searches suggested. If you have enough findings, call done.'
        });
      } else {
        messages.push({
          role: 'user',
          content: 'Continue researching or call done if complete.'
        });
      }
    } else if (!result.toolCalls || result.toolCalls.length === 0) {
      // No tool calls - prompt to continue
      messages.push({
        role: 'user',
        content: 'Continue searching and adding findings, or call done if complete.'
      });
    } else {
      messages.push({
        role: 'user',
        content: 'Continue. Search for more info, add findings, or reflect to assess progress.'
      });
    }
  }

  const finalInit = getInitiative(doc, initiativeId);
  log(initiativeId, `──── CYCLE ${cycleNumber} COMPLETE ────`);
  log(initiativeId, `Stats:`, {
    iterations: iterationsDone,
    queriesExecuted: queriesExecuted.length,
    findings: finalInit?.findings.length || 0,
    shouldContinue: !doneSignaled
  });

  onProgress?.({
    type: 'initiative_cycle_completed',
    initiativeId,
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
 * Run a full initiative until completion (multiple cycles)
 */
export async function runInitiativeToCompletion(
  config: InitiativeAgentConfig
): Promise<InitiativeAgentResult> {
  let doc = config.doc;
  let totalCreditsUsed = 0;
  const allQueries: string[] = [];

  const initiative = getInitiative(doc, config.initiativeId);
  if (!initiative) {
    return { doc, shouldContinue: false, queriesExecuted: [], creditsUsed: 0 };
  }

  const maxCycles = initiative.maxCycles;

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    if (config.abortSignal?.aborted) break;

    const result = await executeInitiativeCycle({
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
  const finalInitiative = getInitiative(doc, config.initiativeId);
  if (finalInitiative && finalInitiative.status !== 'done') {
    const activeFindings = finalInitiative.findings.filter(f => f.status === 'active');
    doc = completeInitiative(
      doc,
      config.initiativeId,
      `Max cycles reached with ${activeFindings.length} findings`,
      activeFindings.length >= 3 ? 'medium' : 'low',
      activeFindings.length >= 5 ? 'promising' : 'needs_more'
    );
  }

  return {
    doc,
    shouldContinue: false,
    queriesExecuted: allQueries,
    creditsUsed: totalCreditsUsed
  };
}
