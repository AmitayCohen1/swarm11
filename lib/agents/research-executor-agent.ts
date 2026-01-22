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
  createResearchMemory,
  appendLogEntry,
  addQueryToMemory,
  formatLogForAgent,
  updateWorkingMemory
} from '@/lib/utils/research-memory';
import type { ResearchMemory, LogEntry } from '@/lib/types/research-memory';

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
 * Research Executor Agent - Append-Only Log Architecture
 *
 * New loop: search → log → checkDone (no planning state)
 * Agent decides fresh every iteration - no persisted strategy.
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

  const logTool = tool({
    description: `Log your findings after each search iteration. Answer all four questions.

    OBJECTIVE: ${researchBrief.objective}
    DONE_WHEN: ${researchBrief.doneWhen}

    After searching, you MUST call this tool to log:
    1. method - What approach did you try THIS step? (ephemeral - don't plan ahead)
    2. signal - What did you observe in the results?
    3. insight - What did you learn?
    4. progressTowardObjective - How does this help or block reaching DONE_WHEN? Be explicit!
    5. isDone - Have you satisfied DONE_WHEN or proven it impossible?

    isDone should be true ONLY if:
    - You have enough information to satisfy DONE_WHEN, OR
    - You've proven DONE_WHEN is impossible to satisfy

    If neither, set isDone to false and continue searching with a DIFFERENT method.`,
    inputSchema: z.object({
      method: z.string().describe('What approach did you try THIS step? (e.g., "Searched for CEO LinkedIn profiles")'),
      signal: z.string().describe('What did you observe in the search results?'),
      insight: z.string().describe('What did you learn from this?'),
      progressTowardObjective: z.string().describe('How does this help/block reaching DONE_WHEN? Compare explicitly to the stopping condition.'),
      mood: z.enum(['exploring', 'promising', 'dead_end', 'breakthrough']).describe('How did this iteration go? exploring=still looking, promising=getting closer, dead_end=this path failed, breakthrough=found what we need'),
      isDone: z.boolean().describe('True if DONE_WHEN is satisfied OR proven impossible. False if more research needed.'),
      sources: z.array(z.object({
        url: z.string(),
        title: z.string()
      })).describe('Key sources from this iteration')
    }),
    execute: async ({ method, signal, insight, progressTowardObjective, mood, isDone, sources }) => {
      // Load current memory
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (!memory) {
        memory = createResearchMemory(researchBrief.objective, researchBrief.doneWhen);
      }

      // Append log entry
      memory = appendLogEntry(memory, {
        method,
        signal,
        insight,
        progressTowardObjective,
        mood,
        sources
      });

      // Save to DB
      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      // Get the just-added entry
      const newEntry = memory.log[memory.log.length - 1];

      // Emit progress
      emitProgress('log_entry_added', {
        entry: newEntry,
        logCount: memory.log.length,
        isDone
      });
      emitProgress('brain_update', { brain: serializedBrain });

      return {
        logged: true,
        entryId: newEntry.id,
        isDone,
        totalEntries: memory.log.length
      };
    }
  });

  const updateMemoryTool = tool({
    description: `Update working memory with a narrative summary of the research journey (5-10 bullets).

    Write it like a story someone can skim to understand what happened:
    - What you tried and why
    - What you realized/learned
    - How you pivoted when something didn't work
    - What criteria you're using for success

    Good examples:
    - "Started with obvious high-budget targets - looked up major podcast networks"
    - "Realized org names weren't enough - needed actual decision-makers with contact info"
    - "Shifted to LinkedIn to find people, not brands"
    - "Dropped dead ends fast - conference sites gave names but no contacts"
    - "A prospect only counts if it has: name, org, LinkedIn/email, clear fit reason"

    Bad examples:
    - "Searched Google" (too vague, no insight)
    - "Found 5 results" (just a number, no meaning)

    Call when:
    - Your mood is 'breakthrough' or 'dead_end'
    - You pivoted to a new approach
    - Every 3-4 iterations to keep the narrative current`,
    inputSchema: z.object({
      bullets: z.array(z.string()).min(1).max(10)
        .describe('Narrative summary - the story of your research journey so far, written for easy skimming')
    }),
    execute: async ({ bullets }) => {
      // Load current memory
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (!memory) {
        memory = createResearchMemory(researchBrief.objective, researchBrief.doneWhen);
      }

      // Update working memory (overwrites, not appends)
      memory = updateWorkingMemory(memory, bullets);

      // Save to DB
      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit progress
      emitProgress('working_memory_updated', {
        bullets: memory.workingMemory.bullets,
        lastUpdated: memory.workingMemory.lastUpdated
      });
      emitProgress('brain_update', { brain: serializedBrain });

      return {
        updated: true,
        bulletCount: bullets.length,
        message: 'Working memory updated with current conclusions'
      };
    }
  });

  const finishTool = tool({
    description: `Deliver your final research answer. Use this after logTool returns isDone=true.`,
    inputSchema: z.object({
      confidenceLevel: z.enum(['low', 'medium', 'high']),
      finalAnswer: z.string().describe('Complete answer to the research objective'),
      doneWhenStatus: z.string().describe('Explain how DONE_WHEN was satisfied or why it was impossible')
    }),
    execute: async ({ confidenceLevel, finalAnswer, doneWhenStatus }) => {
      emitProgress('synthesizing_started');
      return { confidenceLevel, finalAnswer, doneWhenStatus };
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

  const systemPrompt = `You are an autonomous research agent with three layers of memory:

┌─────────────────────────────────────┐
│  OBJECTIVE + DONE_WHEN              │  ← Stable north star (never drifts)
├─────────────────────────────────────┤
│  WORKING MEMORY (5-10 bullets)      │  ← Compressed conclusions (overwrites)
├─────────────────────────────────────┤
│  FULL LOG (append-only)             │  ← Raw brain trace (grows forever)
└─────────────────────────────────────┘

OBJECTIVE: ${researchBrief.objective}
DONE_WHEN: ${researchBrief.doneWhen}

YOUR LOOP (repeat until done):
1. Read OBJECTIVE + DONE_WHEN
2. Read WORKING MEMORY (compressed state - this is your primary context)
3. Think: "What is the biggest remaining unknown?"
4. Execute ONE search
5. Call logTool to record: method, signal, insight, progressTowardObjective
6. Update working memory if conclusions changed (on breakthrough/dead_end)
7. Check DONE_WHEN - set isDone=true only if satisfied or proven impossible
8. Continue or finish

WORKING MEMORY is "what we KNOW" not "what we tried":
- Good: "Direct market size data does not exist publicly"
- Bad: "Searched for market reports" (that's an action)

KEY PRINCIPLES:
- Each iteration tries a DIFFERENT method (don't repeat what failed)
- method is ephemeral - describes THIS step only, not a reusable strategy
- progressTowardObjective MUST reference DONE_WHEN explicitly
- Working memory keeps you from re-learning the same things

WATCH FOR SIGNALS:
- Engagement over credentials (who's actually influential, not just titled)
- Activity changes (drops may signal openness to change)
- Cross-surface presence (same person across sources = real)
- Timing (recent events that create opportunity)

COMMON TRAPS:
- Accepting generic lists as "results"
- Repeating similar searches hoping for different results
- Stopping at credentials when you need quality signals
- Setting isDone=true prematurely (be rigorous!)

${existingBrain ? `PREVIOUS RESEARCH:\n${formatLogForAgent(parseResearchMemory(existingBrain)!, 10)}` : ''}`;

  let conversationContext = '';
  if (conversationHistory.length > 0) {
    conversationContext = '\n\nCONVERSATION CONTEXT:\n' +
      conversationHistory.slice(-5).map((m: any) =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n');
  }

  // ============================================================
  // PHASE 1: INITIALIZE MEMORY
  // ============================================================

  console.log('[Research] ═══════════════════════════════════════════════════');
  console.log('[Research] PHASE 1: INITIALIZE');
  console.log('[Research] ═══════════════════════════════════════════════════');

  await checkAborted();

  // Initialize memory if needed
  const [initialSession] = await db
    .select({ brain: chatSessions.brain })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));

  let memory = parseResearchMemory(initialSession?.brain || '');
  if (!memory) {
    memory = createResearchMemory(researchBrief.objective, researchBrief.doneWhen);
    const serializedBrain = serializeResearchMemory(memory);
    await db
      .update(chatSessions)
      .set({ brain: serializedBrain, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    emitProgress('brain_update', { brain: serializedBrain });
  }

  emitProgress('research_initialized', {
    objective: researchBrief.objective,
    doneWhen: researchBrief.doneWhen
  });

  // ============================================================
  // PHASE 2: SEARCH/LOG LOOP
  // ============================================================

  let researchDone = false;
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

    memory = parseResearchMemory(session?.brain || '');
    if (!memory) {
      memory = createResearchMemory(researchBrief.objective, researchBrief.doneWhen);
    }

    // Format log for context
    const logContext = formatLogForAgent(memory, 8);

    // ──────────────────────────────────────────────────────────
    // SEARCH
    // ──────────────────────────────────────────────────────────

    const searchPrompt = `CURRENT STATE:
${logContext}

DONE_WHEN: ${researchBrief.doneWhen}

Think: What is ONE different method worth trying to make progress toward DONE_WHEN?
Then execute a search. After getting results, call logTool to record your findings.`;

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
      queries: completedQueries
    });

    // Track queries in memory
    for (const sq of completedQueries) {
      memory = addQueryToMemory(memory, sq.query);

      await db.insert(searchQueries).values({
        researchSessionId,
        query: sq.query,
        queryNormalized: sq.query.toLowerCase().trim(),
        purpose: sq.purpose,
        answer: sq.answer,
        sources: sq.sources,
        cycleNumber: iterationCount
      });
    }

    // Save updated query list
    const serializedBrain = serializeResearchMemory(memory);
    await db
      .update(chatSessions)
      .set({ brain: serializedBrain, updatedAt: new Date() })
      .where(eq(chatSessions.id, chatSessionId));
    emitProgress('brain_update', { brain: serializedBrain });

    console.log(`[Research] Search complete: ${completedQueries.length} queries`);

    // ──────────────────────────────────────────────────────────
    // LOG (replaces reflect)
    // ──────────────────────────────────────────────────────────

    await checkAborted();
    console.log(`[Research] ITERATION ${iterationCount}: LOG`);

    const logPrompt = `You just searched. Now call logTool to record your findings.

OBJECTIVE: ${researchBrief.objective}
DONE_WHEN: ${researchBrief.doneWhen}

Record:
1. method - What approach did you try?
2. signal - What did you observe?
3. insight - What did you learn?
4. progressTowardObjective - How does this help/block reaching DONE_WHEN? (be explicit!)
5. isDone - Is DONE_WHEN satisfied or proven impossible?

Be rigorous about isDone - only set true if you can clearly justify it against DONE_WHEN.`;

    researchMessages.push({ role: 'user', content: logPrompt });

    const logResult = await generateText({
      model,
      system: systemPrompt,
      messages: researchMessages,
      tools: { log: logTool },
      toolChoice: { type: 'tool', toolName: 'log' },
      abortSignal
    });

    trackUsage(logResult.usage);
    toolSequence.push('log');

    const logOutput = logResult.toolResults?.[0];
    const logData = (logOutput as any)?.output || {};

    // Get log args for conversation context
    const logArgs = (logResult.toolCalls?.[0] as any)?.args || {};
    researchMessages.push({
      role: 'assistant',
      content: `Logged: ${logArgs.method}\nInsight: ${logArgs.insight}\nProgress: ${logArgs.progressTowardObjective}\nisDone: ${logArgs.isDone}`
    });

    console.log(`[Research] Log complete: isDone=${logData.isDone}, entries=${logData.totalEntries}`);

    // ──────────────────────────────────────────────────────────
    // UPDATE WORKING MEMORY (if significant finding)
    // ──────────────────────────────────────────────────────────

    // Trigger working memory update on breakthrough/dead_end or every 3 iterations
    const shouldUpdateMemory =
      logArgs.mood === 'breakthrough' ||
      logArgs.mood === 'dead_end' ||
      iterationCount % 3 === 0;

    if (shouldUpdateMemory) {
      await checkAborted();
      console.log(`[Research] ITERATION ${iterationCount}: UPDATE WORKING MEMORY (mood: ${logArgs.mood})`);

      const updateMemoryPrompt = `Your last finding was ${logArgs.mood === 'breakthrough' ? 'a breakthrough' : logArgs.mood === 'dead_end' ? 'a dead end' : 'worth consolidating'}.

Update your working memory with the story so far.

Write 5-10 bullets that tell the narrative of this research:
- What approaches you tried and why
- What you realized or learned
- How you pivoted when something didn't work
- What's working vs what's not
- What counts as "done" (your success criteria)

Write it so someone can skim and instantly understand the journey.

Example style:
- "Started with X because Y"
- "Realized X wasn't enough - needed Y"
- "Shifted to X to find Y, not Z"
- "Dropped X fast - gave names but no contacts"
- "Only counting prospects with: name, org, contact, fit reason"`;

      researchMessages.push({ role: 'user', content: updateMemoryPrompt });

      const updateMemoryResult = await generateText({
        model,
        system: systemPrompt,
        messages: researchMessages,
        tools: { updateMemory: updateMemoryTool },
        toolChoice: { type: 'tool', toolName: 'updateMemory' },
        abortSignal
      });

      trackUsage(updateMemoryResult.usage);
      toolSequence.push('updateMemory');

      const updateMemoryArgs = (updateMemoryResult.toolCalls?.[0] as any)?.args || {};
      researchMessages.push({
        role: 'assistant',
        content: `Updated working memory with ${updateMemoryArgs.bullets?.length || 0} conclusions`
      });

      console.log(`[Research] Working memory updated: ${updateMemoryArgs.bullets?.length || 0} bullets`);
    }

    if (logData.isDone) {
      researchDone = true;
    }

    emitProgress('research_iteration', {
      iteration: iterationCount,
      searchCount,
      isDone: logData.isDone,
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
  emitProgress('review_started');

  // Get final state for review
  const [reviewSession] = await db
    .select({ brain: chatSessions.brain })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));

  const reviewMemory = parseResearchMemory(reviewSession?.brain || '');
  const recentInsights = reviewMemory?.log.slice(-10).map(e =>
    `Method: ${e.method}\nInsight: ${e.insight}\nProgress: ${e.progressTowardObjective}`
  ).join('\n\n') || 'No log entries';

  const reviewerPrompt = `You are a hostile reviewer. Your job is to block weak conclusions.
Assume the researcher is wrong unless proven otherwise.

OBJECTIVE: ${researchBrief.objective}
DONE_WHEN: ${researchBrief.doneWhen}

RESEARCH LOG (recent entries):
${recentInsights}

QUERIES RUN: ${reviewMemory?.queriesRun?.length || 0}

Evaluate harshly. Is DONE_WHEN actually satisfied?
- If the evidence is weak or doesn't match DONE_WHEN → FAIL
- If solid evidence supports the stopping condition → PASS`;

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
      content: `REVIEWER REJECTION: ${reviewVerdict.critique}\nMissing: ${reviewVerdict.missing.join(', ')}\n\nAddress these gaps with a DIFFERENT method.`
    });

    // Quick search to address gaps
    iterationCount++;

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
  const allInsights = finalMemory?.log.map(e => e.insight).join('\n- ') || 'No insights';
  const finalProgress = finalMemory?.log[finalMemory.log.length - 1]?.progressTowardObjective || 'Unknown';

  // Build reviewer context for finish
  const reviewerContext = reviewVerdict.verdict === 'pass'
    ? `REVIEWER APPROVED: ${reviewVerdict.critique}`
    : `REVIEWER NOTES (address these): ${reviewVerdict.critique}${reviewVerdict.missing?.length ? `\nGaps identified: ${reviewVerdict.missing.join(', ')}` : ''}`;

  const finishResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `Research complete. Here's what you found:

KEY INSIGHTS:
- ${allInsights}

LATEST PROGRESS ASSESSMENT: ${finalProgress}

${reviewerContext}

OBJECTIVE: ${researchBrief.objective}
DONE_WHEN: ${researchBrief.doneWhen}

Synthesize your final answer. Explain how DONE_WHEN was satisfied (or why it proved impossible).`,
    tools: { finish: finishTool },
    toolChoice: { type: 'tool', toolName: 'finish' },
    abortSignal
  });

  trackUsage(finishResult.usage);
  toolSequence.push('finish');

  const finishOutput = finishResult.toolResults?.[0];
  const output = (finishOutput as any)?.output || {
    confidenceLevel: 'low',
    finalAnswer: 'Research completed but no answer extracted.',
    doneWhenStatus: 'Unknown'
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
