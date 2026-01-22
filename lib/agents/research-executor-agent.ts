import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { search, extract } from '@/lib/tools/tavily-search';
import { db } from '@/lib/db';
import { chatSessions, searchQueries } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ResearchBrief } from './orchestrator-chat-agent';
import {
  parseResearchMemory,
  serializeResearchMemory,
  addSearchToMemory,
  completeCycle,
  startCycle,
  formatForOrchestrator
} from '@/lib/utils/research-memory';
import type { ResearchMemory, SearchResult, ExplorationItem } from '@/lib/types/research-memory';

interface ResearchExecutorConfig {
  chatSessionId: string;
  researchSessionId: string;
  userId: string;
  researchBrief: ResearchBrief;
  conversationHistory?: any[];
  existingBrain?: string;
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

/**
 * Research Executor Agent - Custom loop with explicit phases
 *
 * Flow: plan() → search() → reflect() → [loop or finish()]
 *
 * Each phase is a separate generateText call with forced tool choice.
 * Much cleaner than ToolLoopAgent callbacks.
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    researchSessionId,
    userId,
    researchBrief,
    conversationHistory = [],
    existingBrain = '',
    onProgress,
    abortSignal
  } = config;

  const MAX_ITERATIONS = 50;
  const model = openai('gpt-4.1');

  let totalCreditsUsed = 0;
  let iterationCount = 0;
  let searchCount = 0;
  let cycleCounter = 1;
  const toolSequence: string[] = [];

  // ============================================================
  // HELPERS
  // ============================================================

  const checkAborted = async () => {
    if (abortSignal?.aborted) {
      throw new Error('Research aborted');
    }
    const [session] = await db
      .select({ status: chatSessions.status })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));
    if (session?.status !== 'researching') {
      throw new Error('Research stopped by user');
    }
  };

  const trackUsage = (usage: any) => {
    const credits = Math.ceil((usage?.totalTokens || 0) / 1000);
    totalCreditsUsed += credits;
  };

  const emitProgress = (type: string, data: any = {}) => {
    onProgress?.({ type, ...data });
  };

  // ============================================================
  // TOOL DEFINITIONS
  // ============================================================

  // Convert brief initiatives to exploration list format
  const briefInitiatives: ExplorationItem[] = (researchBrief.initiatives || []).map(init => ({
    item: init.question,
    done: false,
    doneWhen: init.doneWhen
  }));

  const planTool = tool({
    description: `Initialize the research plan. Called once at the start.`,
    inputSchema: z.object({
      acknowledged: z.boolean().describe('Set to true to start research')
    }),
    execute: async () => {
      emitProgress('plan_started');

      const list = briefInitiatives.length > 0 ? briefInitiatives : [{
        item: researchBrief.objective,
        done: false
      }];

      const memory: ResearchMemory = {
        version: 1,
        objective: researchBrief.objective,
        cycles: [],
        queriesRun: [],
        explorationList: list
      };

      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      emitProgress('list_updated', { list });
      emitProgress('brain_update', { brain: serializedBrain });
      emitProgress('plan_completed', { initiativeCount: list.length });

      return { acknowledged: true, initiatives: list.map(i => i.item) };
    }
  });

  const reflectTool = tool({
    description: `Analyze search results. 
    Write what you learned, and what you plan to do next, and if there are any operations you need to perform.

    These are the current initiatives:
    ${briefInitiatives.map(i => `- ${i.item} [${i.done ? 'done' : 'pending'}]`).join('\n')}

    You can add new initiatives, add subtasks to existing initiatives, or remove ones that are no longer needed.
    Types of operations: "done", "add", "remove".

    Operations:
    - {action: "done", target: 0, note: "why this is useful"}
    - {action: "add", target: "0", item: "Drill-down question", note: "why needed"}
    - {action: "remove", target: 0, note: "why this is no longer needed"}

    Set done=true ONLY when you have actionable, specific information.`,
    inputSchema: z.object({
      reflection: z.string(),
      operations: z.array(z.object({
        action: z.enum(['done', 'remove', 'add']),
        target: z.union([z.number(), z.string()]),
        item: z.string().optional(),
        note: z.string().optional().describe('Brief reason for this operation, e.g. "Found 3 companies matching criteria"')
      })).optional(),
      done: z.boolean()
    }),
    execute: async ({ reflection, operations, done }) => {
      emitProgress('reasoning', { reflection });

      // Load and update memory
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (!memory) {
        memory = {
          version: 1,
          objective: researchBrief.objective,
          cycles: [],
          queriesRun: []
        };
      }

      let list: ExplorationItem[] = JSON.parse(JSON.stringify(memory.explorationList || []));

      // Process operations
      if (operations && operations.length > 0) {
        const parseTarget = (target: number | string): { parent: number; sub?: number } => {
          if (typeof target === 'number') return { parent: target };
          const parts = String(target).split('.');
          return { parent: parseInt(parts[0]), sub: parts[1] !== undefined ? parseInt(parts[1]) : undefined };
        };

        for (const op of operations) {
          const { parent, sub } = parseTarget(op.target);
          if (op.action === 'done') {
            if (sub !== undefined && list[parent]?.subtasks?.[sub]) {
              list[parent].subtasks[sub].done = true;
            } else if (list[parent]) {
              list[parent].done = true;
            }
          } else if (op.action === 'add' && op.item) {
            if (sub !== undefined && list[parent]) {
              if (!list[parent].subtasks) list[parent].subtasks = [];
              list[parent].subtasks.push({ item: op.item, done: false });
            } else {
              list.push({ item: op.item, done: false });
            }
          } else if (op.action === 'remove') {
            if (sub !== undefined && list[parent]?.subtasks) {
              list[parent].subtasks.splice(sub, 1);
            } else if (parent < list.length) {
              list.splice(parent, 1);
            }
          }
        }
      }

      memory.explorationList = list;
      memory = completeCycle(memory, reflection, done ? 'done' : 'continue');

      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit operations with notes for UI popups
      if (operations && operations.length > 0) {
        emitProgress('list_operations', {
          operations: operations.map(op => ({
            action: op.action,
            target: op.target,
            item: op.item,
            note: op.note
          }))
        });
      }

      emitProgress('list_updated', { list });
      emitProgress('brain_update', { brain: serializedBrain });

      // Count pending
      let pendingCount = 0;
      for (const item of list) {
        if (!item.done) pendingCount++;
        for (const sub of item.subtasks || []) {
          if (!sub.done) pendingCount++;
        }
      }

      const actualDone = done && pendingCount === 0;
      const nextActive = list.find(i => !i.done)?.item || null;

      emitProgress('reflect_completed', {
        decision: actualDone ? 'finishing' : 'continuing',
        pendingCount,
        doneCount: list.filter(i => i.done).length
      });

      return { done: actualDone, nextInitiative: nextActive, pendingCount };
    }
  });

  const finishTool = tool({
    description: `Deliver your final research answer.`,
    inputSchema: z.object({
      confidenceLevel: z.enum(['low', 'medium', 'high']),
      finalAnswer: z.string()
    }),
    execute: async ({ confidenceLevel, finalAnswer }) => {
      emitProgress('synthesizing_started');

      // Mark all initiatives done
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (memory?.explorationList) {
        for (const item of memory.explorationList) {
          item.done = true;
          for (const sub of item.subtasks || []) {
            sub.done = true;
          }
        }

        const serializedBrain = serializeResearchMemory(memory);
        await db
          .update(chatSessions)
          .set({ brain: serializedBrain, updatedAt: new Date() })
          .where(eq(chatSessions.id, chatSessionId));

        emitProgress('list_updated', { list: memory.explorationList });
        emitProgress('brain_update', { brain: serializedBrain });
      }

      return { confidenceLevel, finalAnswer };
    }
  });

  // ============================================================
  // BUILD CONTEXT
  // ============================================================

  const systemPrompt = `You are an autonomous research agent.

OBJECTIVE: ${researchBrief.objective}

RULES:
  - Be smart and creative. Look for signals. Start broad, then narrow down.
  - Work systematically. Understand the best ways to tackle the objective.
  - Explore different directions. Then double down or pivot.

${existingBrain ? `PREVIOUS RESEARCH:\n${formatForOrchestrator(parseResearchMemory(existingBrain), 3000)}` : ''}

Research until you have actionable, specific information that fulfills the objective.`;

  let conversationContext = '';
  if (conversationHistory.length > 0) {
    conversationContext = '\n\nCONVERSATION CONTEXT:\n' +
      conversationHistory.slice(-5).map((m: any) =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n');
  }

  // ============================================================
  // PHASE 1: PLAN
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 1: PLAN');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();

  const planResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `${conversationContext}

Create a research plan with 2-4 specific initiatives.
Each initiative should be a specific question you need to answer.
Initatives msut be standalone, and spesific.
Good: "Which podcast networks have 10M+ listeners?"
Bad: "Research the podcast industry"

Call the plan tool now.`,
    tools: { plan: planTool },
    toolChoice: { type: 'tool', toolName: 'plan' },
    abortSignal
  });

  trackUsage(planResult.usage);
  toolSequence.push('plan');
  console.log('[Research] Plan created');

  // ============================================================
  // PHASE 2: SEARCH/REFLECT LOOP
  // ============================================================

  let researchDone = false;

  // Conversation memory - accumulates throughout the session
  const researchMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const foundUrls: string[] = []; // Track URLs found for potential extraction

  while (!researchDone && iterationCount < MAX_ITERATIONS) {
    iterationCount++;
    await checkAborted();

    console.log('[Research] ───────────────────────────────────────────────────');
    console.log(`[Research] ITERATION ${iterationCount}: SEARCH`);

    // Get current state
    const [session] = await db
      .select({ brain: chatSessions.brain })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    const memory = parseResearchMemory(session?.brain || '');
    const currentList = memory?.explorationList || [];
    const activeInitiative = currentList.find(i => !i.done)?.item || 'General research';

    // Format list for context
    const listContext = currentList.map((item, idx) => {
      const status = item.done ? 'done' : 'pending';
      let line = `${idx}. ${item.item} [${status}]`;
      if (item.subtasks) {
        for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
          const sub = item.subtasks[subIdx];
          line += `\n   ${idx}.${subIdx} ${sub.item} [${sub.done ? 'done' : 'pending'}]`;
        }
      }
      return line;
    }).join('\n');

    // ──────────────────────────────────────────────────────────
    // SEARCH OR EXTRACT
    // ──────────────────────────────────────────────────────────

    emitProgress('phase_change', { phase: 'searching', activeInitiative });

    // Build the search prompt with context
    const searchPrompt = `Current initiatives:
${listContext}

Active: "${activeInitiative}"

${foundUrls.length > 0 ? `URLs found in previous searches (can extract for details):\n${foundUrls.slice(-10).join('\n')}\n` : ''}

Choose the right tool:
- search: Find NEW information (don't repeat previous queries!)
- extract: Scrape specific URLs for detailed content (contacts, team pages, pricing)

If previous searches were too generic, try a MORE SPECIFIC query or extract URLs for details.`;

    // Add search request to conversation
    researchMessages.push({ role: 'user', content: searchPrompt });

    const gatherResult = await generateText({
      model,
      system: systemPrompt,
      messages: researchMessages,
      tools: { search, extract },
      toolChoice: 'required',
      abortSignal
    });

    trackUsage(gatherResult.usage);
    const gatherToolCall = gatherResult.toolCalls?.[0];
    const toolUsed = (gatherToolCall as any)?.toolName || 'search';
    toolSequence.push(toolUsed);
    searchCount++;

    // Process results based on which tool was used
    let searchResultData: any[] = [];
    let queryArgs: any[] = [];

    let isExtract = false;

    if (toolUsed === 'search') {
      queryArgs = (gatherToolCall as any)?.args?.queries || [];
      emitProgress('search_started', {
        count: queryArgs.length,
        totalSearches: searchCount,
        activeInitiative,
        queries: queryArgs
      });

      const searchOutput = gatherResult.toolResults?.[0];
      searchResultData = (searchOutput as any)?.output?.results || [];
    } else if (toolUsed === 'extract') {
      isExtract = true;
      const extractArgs = (gatherToolCall as any)?.args || {};
      const urls = extractArgs.urls || [];

      emitProgress('extract_started', {
        count: urls.length,
        totalSearches: searchCount,
        activeInitiative,
        urls,
        purpose: extractArgs.purpose
      });

      const extractOutput = gatherResult.toolResults?.[0];
      const extractResults = (extractOutput as any)?.output?.results || [];
      const failedResults = (extractOutput as any)?.output?.failed || [];

      // Emit extract_completed with dedicated format
      emitProgress('extract_completed', {
        totalSearches: searchCount,
        activeInitiative,
        results: extractResults.map((r: any) => ({
          url: r.url,
          content: r.content || 'No content extracted',
          status: 'success'
        })),
        failed: failedResults,
        purpose: extractArgs.purpose
      });

      // Convert extract results to search-like format for memory/downstream processing
      searchResultData = extractResults.map((r: any) => ({
        query: `Extracted from ${r.url}`,
        purpose: extractArgs.purpose,
        answer: r.content?.substring(0, 1000) || 'No content',
        results: [{ title: r.url, url: r.url, content: r.content }],
        status: 'success'
      }));
      queryArgs = [{ query: `Extract: ${urls.join(', ')}`, purpose: extractArgs.purpose }];
    }

    const completedQueries = searchResultData.map((sr: any) => ({
      query: sr.query,
      purpose: sr.purpose,
      answer: sr.answer || '',
      sources: (sr.results || []).map((r: any) => ({ title: r.title, url: r.url })),
      status: sr.status === 'success' ? 'complete' : 'error'
    }));

    // Track URLs found for potential extraction
    for (const sq of completedQueries) {
      for (const source of sq.sources || []) {
        if (source.url && !foundUrls.includes(source.url)) {
          foundUrls.push(source.url);
        }
      }
    }

    // Add search results to conversation memory
    const searchResultsSummary = completedQueries.map((q: any) =>
      `Query: ${q.query}\nAnswer: ${q.answer?.substring(0, 300) || 'No answer'}\nSources: ${q.sources?.map((s: any) => s.url).join(', ') || 'none'}`
    ).join('\n\n');
    researchMessages.push({ role: 'assistant', content: `Search results:\n${searchResultsSummary}` });

    // Only emit search_completed for search (extract has its own event)
    if (!isExtract) {
      emitProgress('search_completed', {
        totalSearches: searchCount,
        activeInitiative,
        queries: completedQueries
      });
    }

    // Save searches to memory
    if (memory) {
      let updatedMemory = memory;
      if (updatedMemory.cycles.length === 0) {
        updatedMemory = startCycle(updatedMemory, activeInitiative);
      }
      for (const sq of completedQueries) {
        const searchEntry: SearchResult = {
          query: sq.query,
          purpose: sq.purpose,
          answer: sq.answer,
          sources: sq.sources
        };
        updatedMemory = addSearchToMemory(updatedMemory, searchEntry);

        await db.insert(searchQueries).values({
          researchSessionId,
          query: sq.query,
          queryNormalized: sq.query.toLowerCase().trim(),
          purpose: sq.purpose,
          answer: sq.answer,
          sources: sq.sources,
          cycleNumber: cycleCounter
        });
      }
      const serializedBrain = serializeResearchMemory(updatedMemory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));
      emitProgress('brain_update', { brain: serializedBrain });
    }

    console.log(`[Research] Search complete: ${completedQueries.length} queries`);

    // ──────────────────────────────────────────────────────────
    // REFLECT
    // ──────────────────────────────────────────────────────────

    await checkAborted();
    console.log(`[Research] ITERATION ${iterationCount}: REFLECT`);

    emitProgress('phase_change', { phase: 'reflecting' });
    emitProgress('reasoning_started');

    // Get fresh state after search
    const [freshSession] = await db
      .select({ brain: chatSessions.brain })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    const freshMemory = parseResearchMemory(freshSession?.brain || '');
    const freshList = freshMemory?.explorationList || [];
    const freshListContext = freshList.map((item, idx) => {
      const status = item.done ? 'done' : 'pending';
      let line = `${idx}. ${item.item} [${status}]`;
      if (item.subtasks) {
        for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
          const sub = item.subtasks[subIdx];
          line += `\n   ${idx}.${subIdx} ${sub.item} [${sub.done ? 'done' : 'pending'}]`;
        }
      }
      return line;
    }).join('\n');

    // Build reflect prompt
    const reflectPrompt = `OBJECTIVE: ${researchBrief.objective}

Current initiatives:
${freshListContext}

Reflect on the search results above. Ask yourself:
- Is this SPECIFIC enough? Or just generic names anyone could Google?
- Do I have what the objective asks for? (e.g., if it needs "contacts", do I have actual names/emails?)
- Should I EXTRACT some of the URLs found to get more details?

If results are generic, either:
1. Search with a MORE SPECIFIC query (e.g., "Head of Content at iHeartMedia LinkedIn")
2. Extract a promising URL for detailed info

Operations:
- {action: "done", target: 0, note: "why this is useful"}
- {action: "add", target: "0", item: "More specific question", note: "why needed"}`;

    // Add reflect request to conversation
    researchMessages.push({ role: 'user', content: reflectPrompt });

    const reflectResult = await generateText({
      model,
      system: systemPrompt,
      messages: researchMessages,
      tools: { reflect: reflectTool },
      toolChoice: { type: 'tool', toolName: 'reflect' },
      abortSignal
    });

    trackUsage(reflectResult.usage);
    toolSequence.push('reflect');

    const reflectOutput = reflectResult.toolResults?.[0];
    const reflectData = (reflectOutput as any)?.output || {};

    // Get reflection text from tool call args
    const reflectArgs = (reflectResult.toolCalls?.[0] as any)?.args || {};
    const reflectionText = reflectArgs.reflection || '';

    // Add reflection to conversation memory
    researchMessages.push({ role: 'assistant', content: `Reflection: ${reflectionText}` });

    console.log(`[Research] Reflect: done=${reflectData.done}, pending=${reflectData.pendingCount}`);

    if (reflectData.done) {
      researchDone = true;
    } else {
      cycleCounter++;
    }

    emitProgress('research_iteration', {
      iteration: iterationCount,
      searchCount,
      toolSequence: [...toolSequence]
    });
  }

  // ============================================================
  // PHASE 3: FINISH
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 3: FINISH');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();

  // Get final state
  const [finalSession] = await db
    .select({ brain: chatSessions.brain })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));

  const finalMemory = parseResearchMemory(finalSession?.brain || '');
  const allSearches = finalMemory?.cycles?.flatMap(c => c.searches) || [];
  const searchSummary = allSearches.slice(-10).map(s =>
    `Q: ${s.query}\nA: ${s.answer?.substring(0, 300) || 'N/A'}`
  ).join('\n\n');

  const finishResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `Research complete. Here's what you found:

${searchSummary}

Synthesize your final answer for the objective:
"${researchBrief.objective}"

Provide a comprehensive, actionable answer.`,
    tools: { finish: finishTool },
    toolChoice: { type: 'tool', toolName: 'finish' },
    abortSignal
  });

  trackUsage(finishResult.usage);
  toolSequence.push('finish');

  const finishOutput = finishResult.toolResults?.[0];
  const output = (finishOutput as any)?.output || {
    confidenceLevel: 'low',
    finalAnswer: 'Research completed but no answer extracted.'
  };

  // ============================================================
  // COMPLETE
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log(`[Research] COMPLETE: ${toolSequence.join(' → ')}`);
  console.log(`[Research] Iterations: ${iterationCount}, Searches: ${searchCount}`);
  console.log('[Research] ═══════════════════════════════════════════════════');

  emitProgress('research_complete', {
    toolSequence,
    totalSteps: iterationCount,
    totalSearches: searchCount
  });

  return {
    completed: true,
    iterations: iterationCount,
    creditsUsed: totalCreditsUsed,
    toolSequence,
    output
  };
}
