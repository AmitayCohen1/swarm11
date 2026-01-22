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
    description: `Evaluate your search results and decide next steps.

    Current initiatives:
    ${briefInitiatives.map((i, idx) => `${idx}. ${i.item} [${i.done ? 'done' : 'pending'}]\n       DONE WHEN: ${i.doneWhen || 'not specified'}`).join('\n')}

    EVALUATE:
    - Did this search yield signal or noise?
    - Is further searching likely to add value, or diminishing returns?

    Operations:
    - {action: "done", target: 0, note: "Found: [result] OR Concluded: [why low-signal]"}
    - {action: "add", item: "New initiative", note: "Pivoting to different angle"}
    - {action: "add", target: "0", item: "Subtask", note: "Breaking down initiative 0"}
    - {action: "remove", target: 0, note: "Stopping - diminishing returns"}

    Use target: "0" to add subtask under initiative 0. Use target: "0.1" to mark subtask 1 done.

    An initiative can be DONE because:
    ✓ Found actionable result
    ✓ Learned this path is low-signal (negative finding = valid output)
    ✓ Further search adds diminishing value

    Stopping because you learned something is progress.`,
    inputSchema: z.object({
      reflection: z.string().describe(`Markdown formatted reflection. Structure:
## What I Found
- Key findings from this search

## Progress
- Which initiatives are closer to done
- What's still missing

## Next Steps
- What I'll search for next and why`),
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

  const reviewTool = tool({
    description: `Adversarial review of research quality. Be hostile - block weak conclusions.`,
    inputSchema: z.object({
      verdict: z.enum(['pass', 'fail']).describe('pass = research is sufficient, fail = gaps remain'),
      critique: z.string().describe('Why this passes or fails. Be specific.'),
      missing: z.array(z.string()).describe('What specific gaps remain (empty if pass)')
    }),
    execute: async ({ verdict, critique, missing }) => {
      emitProgress('review_completed', { verdict, critique, missing });
      return { verdict, critique, missing };
    }
  });

  // ============================================================
  // BUILD CONTEXT
  // ============================================================

  const systemPrompt = `You are an autonomous research agent.

OBJECTIVE: ${researchBrief.objective}

HOW TO RESEARCH:
1. HYPOTHESIZE - "What's the best way to find this?"
2. TEST - Run searches based on your hypothesis
3. EVALUATE - Did you get actionable signal or noise?
4. DECIDE:
   - Low signal / diminishing returns → STOP this approach, explain why
   - Promising signal → NARROW further
   - Enough signal to act → DONE

WHAT "DONE" MEANS:
Done = enough signal gathered to decide.
This includes NEGATIVE findings: "This approach doesn't work because X" is valid output.
An initiative can end because:
- You found what you needed (success)
- The path is low-signal or inaccessible (learned something)
- Further search adds diminishing value (time to pivot)

Stopping because you learned something is progress, not failure.

WATCH FOR SIGNALS:
- Engagement over credentials (who's actually influential, not just titled)
- Activity changes (drops may signal openness to change)
- Cross-surface presence (same person across sources = real)
- Timing (recent events that create opportunity)

COMMON TRAPS:
- Accepting generic lists as "results"
- Repeating similar searches hoping for different results
- Stopping at credentials when you need quality signals

${existingBrain ? `PREVIOUS RESEARCH:\n${formatForOrchestrator(parseResearchMemory(existingBrain), 3000)}` : ''}`;

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

  // Build initiatives display for context
  const initiativesDisplay = briefInitiatives.map((init, idx) =>
    `${idx + 1}. ${init.item}${init.doneWhen ? `\n   DONE WHEN: ${init.doneWhen}` : ''}`
  ).join('\n');

  const planResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `${conversationContext}

Here are your research initiatives:
${initiativesDisplay}

Call the plan tool to start.`,
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

    // Format list for context - include doneWhen criteria
    const listContext = currentList.map((item, idx) => {
      const status = item.done ? '✓ DONE' : 'PENDING';
      let line = `${idx}. ${item.item} [${status}]`;
      if (item.doneWhen) {
        line += `\n   DONE WHEN: ${item.doneWhen}`;
      }
      if (item.subtasks) {
        for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
          const sub = item.subtasks[subIdx];
          line += `\n   ${idx}.${subIdx} ${sub.item} [${sub.done ? '✓' : 'pending'}]`;
        }
      }
      return line;
    }).join('\n');

    // ──────────────────────────────────────────────────────────
    // SEARCH
    // ──────────────────────────────────────────────────────────


    const searchPrompt = `Current initiatives:
${listContext}

Active: "${activeInitiative}"

Search for information. If previous searches were too generic, try MORE SPECIFIC queries.`;

    researchMessages.push({ role: 'user', content: searchPrompt });

    const searchResult = await generateText({
      model,
      system: systemPrompt,
      messages: researchMessages,
      tools: { search },
      toolChoice: 'required',
      abortSignal
    });

    trackUsage(searchResult.usage);
    toolSequence.push('search');
    searchCount++;

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

    // Add search results to conversation memory
    const searchResultsSummary = completedQueries.map((q: any) =>
      `Query: ${q.query}\nAnswer: ${q.answer?.substring(0, 300) || 'No answer'}\nSources: ${q.sources?.map((s: any) => s.url).join(', ') || 'none'}`
    ).join('\n\n');
    researchMessages.push({ role: 'assistant', content: `Search results:\n${searchResultsSummary}` });

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


    // Get fresh state after search
    const [freshSession] = await db
      .select({ brain: chatSessions.brain })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    const freshMemory = parseResearchMemory(freshSession?.brain || '');
    const freshList = freshMemory?.explorationList || [];
    const freshListContext = freshList.map((item, idx) => {
      const status = item.done ? '✓ DONE' : 'PENDING';
      let line = `${idx}. ${item.item} [${status}]`;
      if (item.doneWhen) {
        line += `\n   DONE WHEN: ${item.doneWhen}`;
      }
      if (item.subtasks) {
        for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
          const sub = item.subtasks[subIdx];
          line += `\n   ${idx}.${subIdx} ${sub.item} [${sub.done ? '✓' : 'pending'}]`;
        }
      }
      return line;
    }).join('\n');

    // Build reflect prompt - simple, tool description has the guidance
    const reflectPrompt = `OBJECTIVE: ${researchBrief.objective}

Current initiatives:
${freshListContext}

Reflect on the search results. Check each initiative against its DONE WHEN criteria.
Call the reflect tool.`;

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
  // PHASE 3: ADVERSARIAL REVIEW (gate before finish)
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 3: ADVERSARIAL REVIEW');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();

  // Get state for review
  const [reviewSession] = await db
    .select({ brain: chatSessions.brain })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));

  const reviewMemory = parseResearchMemory(reviewSession?.brain || '');
  const reviewSearches = reviewMemory?.cycles?.flatMap(c => c.searches) || [];
  const reviewSummary = reviewSearches.slice(-10).map(s =>
    `Q: ${s.query}\nA: ${s.answer?.substring(0, 300) || 'N/A'}`
  ).join('\n\n');

  const reviewerPrompt = `You are a hostile reviewer. Your job is to block weak conclusions.
Assume the researcher is wrong unless proven otherwise.

OBJECTIVE: ${researchBrief.objective}

RESEARCH CONDUCTED:
${reviewSummary}

CURRENT INITIATIVES:
${reviewMemory?.explorationList?.map((i, idx) => `${idx}. ${i.item} [${i.done ? 'DONE' : 'pending'}]`).join('\n') || 'None'}

Evaluate harshly. Is this research sufficient to deliver an actionable answer?
- If weak, vague, or lacks actionable specifics → FAIL
- If solid evidence supports a clear answer → PASS`;

  const reviewResult = await generateText({
    model,
    system: reviewerPrompt,
    prompt: `Review this research. Use the review tool to deliver your verdict.`,
    tools: { review: reviewTool },
    toolChoice: { type: 'tool', toolName: 'review' },
    abortSignal
  });

  trackUsage(reviewResult.usage);
  toolSequence.push('review');

  const reviewOutput = reviewResult.toolResults?.[0];
  const reviewVerdict = (reviewOutput as any)?.output || { verdict: 'pass', critique: '', missing: [] };

  console.log(`[Research] Review verdict: ${reviewVerdict.verdict}`);

  // If review fails and we have iterations left, force another cycle
  if (reviewVerdict.verdict === 'fail' && iterationCount < MAX_ITERATIONS - 1) {
    console.log('[Research] Review failed - forcing additional research cycle');
    emitProgress('review_rejected', {
      critique: reviewVerdict.critique,
      missing: reviewVerdict.missing
    });

    // Add critique to conversation and loop back
    researchMessages.push({
      role: 'user',
      content: `REVIEWER REJECTION: ${reviewVerdict.critique}\nMissing: ${reviewVerdict.missing.join(', ')}\n\nAddress these gaps.`
    });

    // Force one more search/reflect cycle
    iterationCount++;

    // Quick search to address gaps
    const gapSearchResult = await generateText({
      model,
      system: systemPrompt,
      messages: researchMessages,
      tools: { search },
      toolChoice: 'required',
      abortSignal
    });
    trackUsage(gapSearchResult.usage);
    toolSequence.push('search');
    searchCount++;

    const gapSearchOutput = gapSearchResult.toolResults?.[0];
    const gapResults = ((gapSearchOutput as any)?.output?.results || []).map((sr: any) => ({
      query: sr.query,
      answer: sr.answer || '',
      sources: (sr.results || []).map((r: any) => ({ title: r.title, url: r.url }))
    }));

    emitProgress('search_completed', {
      totalSearches: searchCount,
      activeInitiative: 'Addressing reviewer gaps',
      queries: gapResults
    });

    researchMessages.push({
      role: 'assistant',
      content: `Additional search results:\n${gapResults.map((q: any) => `Q: ${q.query}\nA: ${q.answer}`).join('\n\n')}`
    });
  }

  // ============================================================
  // PHASE 4: FINISH
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 4: FINISH');
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

  // Build reviewer context for finish
  const reviewerContext = reviewVerdict.verdict === 'pass'
    ? `REVIEWER APPROVED: ${reviewVerdict.critique}`
    : `REVIEWER NOTES (address these): ${reviewVerdict.critique}${reviewVerdict.missing?.length ? `\nGaps identified: ${reviewVerdict.missing.join(', ')}` : ''}`;

  const finishResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `Research complete. Here's what you found:

${searchSummary}

${reviewerContext}

Synthesize your final answer for the objective:
"${researchBrief.objective}"

Address the reviewer's notes in your synthesis. Provide an actionable answer.`,
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
