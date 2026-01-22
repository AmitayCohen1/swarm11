import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { search } from '@/lib/tools/tavily-search';
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

  const planTool = tool({
    description: `Create your research plan with 1-5 specific initiatives.`,
    inputSchema: z.object({
      list: z.array(z.object({
        item: z.string(),
        done: z.boolean().default(false),
        subtasks: z.array(z.object({
          item: z.string(),
          done: z.boolean().default(false)
        })).optional()
      })).min(1).max(5)
    }),
    execute: async ({ list }) => {
      emitProgress('plan_started');

      // Initialize memory
      let memory: ResearchMemory = {
        version: 1,
        objective: researchBrief.objective,
        successCriteria: researchBrief.successCriteria,
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

      const firstActive = list.find(i => !i.done)?.item || list[0]?.item;
      emitProgress('plan_completed', { initiativeCount: list.length, activeInitiative: firstActive });

      return { acknowledged: true, initiatives: list.map(i => i.item) };
    }
  });

  const reflectTool = tool({
    description: `Analyze what you learned and decide next steps.`,
    inputSchema: z.object({
      reflection: z.string(),
      operations: z.array(z.object({
        action: z.enum(['done', 'remove', 'add']),
        target: z.union([z.number(), z.string()]),
        item: z.string().optional()
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
          successCriteria: researchBrief.successCriteria,
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

SUCCESS CRITERIA: ${researchBrief.successCriteria}

OUTPUT FORMAT: ${researchBrief.outputFormat || 'Whatever fits the data best'}

${existingBrain ? `PREVIOUS RESEARCH:\n${formatForOrchestrator(parseResearchMemory(existingBrain), 3000)}` : ''}

Research relentlessly until you have either a really good result or you've looked everywhere.`;

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
    // SEARCH
    // ──────────────────────────────────────────────────────────

    emitProgress('phase_change', { phase: 'searching', activeInitiative });

    const searchResult = await generateText({
      model,
      system: systemPrompt,
      prompt: `Current initiatives:
${listContext}

Active: "${activeInitiative}"

Search for information about this initiative. Use natural language questions, not keywords.`,
      tools: { search },
      toolChoice: { type: 'tool', toolName: 'search' },
      abortSignal
    });

    trackUsage(searchResult.usage);
    toolSequence.push('search');
    searchCount++;

    // Process search results
    const searchToolCall = searchResult.toolCalls?.[0];
    const queryArgs = (searchToolCall as any)?.args?.queries || [];

    emitProgress('search_started', {
      count: queryArgs.length,
      totalSearches: searchCount,
      activeInitiative,
      queries: queryArgs
    });

    const searchOutput = searchResult.toolResults?.[0];
    const searchResultData = (searchOutput as any)?.output?.results || [];

    const completedQueries = searchResultData.map((sr: any) => ({
      query: sr.query,
      purpose: sr.purpose,
      answer: sr.answer || '',
      sources: (sr.results || []).map((r: any) => ({ title: r.title, url: r.url })),
      status: sr.status === 'success' ? 'complete' : 'error'
    }));

    emitProgress('search_completed', {
      totalSearches: searchCount,
      activeInitiative,
      queries: completedQueries
    });

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

    // Format recent search results
    const recentSearchSummary = completedQueries.map((q: any) =>
      `Q: ${q.query}\nA: ${q.answer?.substring(0, 500) || 'No answer'}...`
    ).join('\n\n');

    const reflectResult = await generateText({
      model,
      system: systemPrompt,
      prompt: `Current initiatives:
${freshListContext}

SEARCH RESULTS:
${recentSearchSummary}

Reflect on what you learned:
1. What concrete facts, names, numbers did you find?
2. What's still missing?
3. Should you mark initiatives done, add subtasks, or continue?

Set done=true ONLY if you have enough to answer the objective.

Use operations to update the list:
- {action: "done", target: 0} - mark initiative 0 done
- {action: "done", target: "0.1"} - mark subtask done
- {action: "add", target: 2, item: "New question"} - add initiative
- {action: "add", target: "0.2", item: "Sub question"} - add subtask`,
      tools: { reflect: reflectTool },
      toolChoice: { type: 'tool', toolName: 'reflect' },
      abortSignal
    });

    trackUsage(reflectResult.usage);
    toolSequence.push('reflect');

    const reflectOutput = reflectResult.toolResults?.[0];
    const reflectData = (reflectOutput as any)?.output || {};

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

Now synthesize your final answer. Address the objective directly:
"${researchBrief.objective}"

Success criteria: ${researchBrief.successCriteria}

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
