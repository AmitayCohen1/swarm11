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
import type { ResearchMemory, SearchResult, ResearchAngle } from '@/lib/types/research-memory';

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

  // Convert brief angles to ResearchAngle format
  const briefAngles: ResearchAngle[] = (researchBrief.angles || []).map(angle => ({
    name: angle.name,
    goal: angle.goal,
    stopWhen: angle.stopWhen,
    status: 'active' as const
  }));

  const planTool = tool({
    description: `Initialize the research plan. Called once at the start.`,
    inputSchema: z.object({
      acknowledged: z.boolean().describe('Set to true to start research')
    }),
    execute: async () => {
      emitProgress('plan_started');

      const angles = briefAngles.length > 0 ? briefAngles : [{
        name: 'Main',
        goal: researchBrief.objective,
        stopWhen: 'Found actionable answer or concluded not findable',
        status: 'active' as const
      }];

      const memory: ResearchMemory = {
        version: 1,
        objective: researchBrief.objective,
        cycles: [],
        queriesRun: [],
        angles
      };

      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      emitProgress('angles_updated', { angles });
      emitProgress('brain_update', { brain: serializedBrain });
      emitProgress('plan_completed', { angleCount: angles.length });

      return { acknowledged: true, angles: angles.map(a => a.name) };
    }
  });

  const reflectTool = tool({
    description: `Evaluate your search results for the CURRENT ANGLE. Decide: continue, mark worked, or mark rejected.

    ANGLES (fixed - you explore these systematically):
    ${briefAngles.map((a, idx) => `${idx}. ${a.name} [${a.status}]\n       Goal: ${a.goal}\n       Stop when: ${a.stopWhen}`).join('\n')}

    For the CURRENT angle, ask:
    - Did this search yield useful signal toward the goal?
    - Have I hit the stop condition (success OR rejection)?

    You control the angle status by setting the angleStatus field:

    If you found useful results for this angle, set angleStatus to "worked".
    If this angle is not producing results and you want to move on, set angleStatus to "rejected".
    If you want to keep searching this angle, set angleStatus to "active".

    When you set "worked" or "rejected", also fill in angleResult to explain what happened.

    Once all angles are either worked or rejected, set done to true.`,
    inputSchema: z.object({
      reflection: z.string().describe(`Markdown formatted reflection. Structure:
## Current Angle
- Which angle I'm working on

## What I Found
- Key findings from this search

## Angle Status
- Did this angle work, get rejected, or need more searching?

## Next
- Continue this angle OR move to next angle OR done`),
      angleIndex: z.number().describe('Index of the angle being evaluated (0-based)'),
      angleStatus: z.enum(['active', 'worked', 'rejected']).describe('New status for this angle'),
      angleResult: z.string().optional().describe('Brief summary of what this angle produced (required if worked/rejected)'),
      done: z.boolean().describe('True if ALL angles are resolved (worked or rejected)')
    }),
    execute: async ({ reflection, angleIndex, angleStatus, angleResult, done }) => {
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
          queriesRun: [],
          angles: briefAngles
        };
      }

      // Update angle status
      const angles: ResearchAngle[] = JSON.parse(JSON.stringify(memory.angles || briefAngles));
      if (angles[angleIndex]) {
        angles[angleIndex].status = angleStatus;
        if (angleResult) {
          angles[angleIndex].result = angleResult;
        }
      }

      memory.angles = angles;
      memory = completeCycle(memory, reflection, done ? 'done' : 'continue');

      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit angle update
      emitProgress('angle_updated', {
        angleIndex,
        angleName: angles[angleIndex]?.name,
        status: angleStatus,
        result: angleResult
      });

      emitProgress('angles_updated', { angles });
      emitProgress('brain_update', { brain: serializedBrain });

      // Count active angles
      const activeAngles = angles.filter(a => a.status === 'active');
      const workedAngles = angles.filter(a => a.status === 'worked');
      const rejectedAngles = angles.filter(a => a.status === 'rejected');

      const allResolved = activeAngles.length === 0;
      const nextAngle = activeAngles[0]?.name || null;

      emitProgress('reflect_completed', {
        decision: allResolved ? 'finishing' : 'continuing',
        activeCount: activeAngles.length,
        workedCount: workedAngles.length,
        rejectedCount: rejectedAngles.length
      });

      return { done: allResolved, nextAngle, activeCount: activeAngles.length };
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

      // Ensure all angles are marked as resolved
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (memory?.angles) {
        // Mark any remaining active angles as worked (research complete)
        for (const angle of memory.angles) {
          if (angle.status === 'active') {
            angle.status = 'worked';
            angle.result = angle.result || 'Completed during synthesis';
          }
        }

        const serializedBrain = serializeResearchMemory(memory);
        await db
          .update(chatSessions)
          .set({ brain: serializedBrain, updatedAt: new Date() })
          .where(eq(chatSessions.id, chatSessionId));

        emitProgress('angles_updated', { angles: memory.angles });
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

ANGLES:
You have a set of ANGLES (strategies) to explore. For each angle:
- Search to make progress on its goal
- Evaluate: did this yield signal or noise?
- Mark as "worked" (found what we needed) or "rejected" (concluded this won't work)
- Move to next angle

An angle can be REJECTED because:
- The path is low-signal or inaccessible
- Further search adds diminishing value
Rejection is valid output - it's learning, not failure.

You're DONE when all angles are resolved (worked or rejected).

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

  // Build angles display for context
  const anglesDisplay = briefAngles.map((angle, idx) =>
    `${idx + 1}. ${angle.name}\n   Goal: ${angle.goal}\n   Stop when: ${angle.stopWhen}`
  ).join('\n\n');

  const planResult = await generateText({
    model,
    system: systemPrompt,
    prompt: `${conversationContext}

Here are your research ANGLES (explore these systematically):
${anglesDisplay}

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
    const currentAngles: ResearchAngle[] = memory?.angles || briefAngles;
    const activeAngle = currentAngles.find(a => a.status === 'active');
    const activeAngleIndex = currentAngles.findIndex(a => a.status === 'active');

    if (!activeAngle) {
      // All angles resolved
      researchDone = true;
      break;
    }

    // Format angles for context
    const anglesContext = currentAngles.map((angle, idx) => {
      const statusIcon = angle.status === 'worked' ? '✓' : angle.status === 'rejected' ? '✗' : '→';
      let line = `${idx}. ${angle.name} [${statusIcon} ${angle.status.toUpperCase()}]`;
      line += `\n   Goal: ${angle.goal}`;
      line += `\n   Stop when: ${angle.stopWhen}`;
      if (angle.result) {
        line += `\n   Result: ${angle.result}`;
      }
      return line;
    }).join('\n\n');

    // ──────────────────────────────────────────────────────────
    // SEARCH
    // ──────────────────────────────────────────────────────────


    const searchPrompt = `ANGLES (explore systematically):
${anglesContext}

CURRENT ANGLE: "${activeAngle.name}"
Goal: ${activeAngle.goal}
Stop when: ${activeAngle.stopWhen}

Search to make progress on this angle. Ask specific questions.`;

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
      activeAngle: activeAngle.name,
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
      activeAngle: activeAngle.name,
      queries: completedQueries
    });

    // Save searches to memory
    if (memory) {
      let updatedMemory = memory;
      if (updatedMemory.cycles.length === 0) {
        updatedMemory = startCycle(updatedMemory, activeAngle.name);
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
    const freshAngles: ResearchAngle[] = freshMemory?.angles || briefAngles;
    const freshAnglesContext = freshAngles.map((angle, idx) => {
      const statusIcon = angle.status === 'worked' ? '✓' : angle.status === 'rejected' ? '✗' : '→';
      let line = `${idx}. ${angle.name} [${statusIcon} ${angle.status.toUpperCase()}]`;
      line += `\n   Goal: ${angle.goal}`;
      line += `\n   Stop when: ${angle.stopWhen}`;
      if (angle.result) {
        line += `\n   Result: ${angle.result}`;
      }
      return line;
    }).join('\n\n');

    // Build reflect prompt
    const reflectPrompt = `OBJECTIVE: ${researchBrief.objective}

CURRENT ANGLE: ${activeAngle.name} (index: ${activeAngleIndex})
Goal: ${activeAngle.goal}
Stop when: ${activeAngle.stopWhen}

ALL ANGLES:
${freshAnglesContext}

Evaluate the search results for the CURRENT ANGLE.
- Did it produce useful signal toward the goal?
- Have you hit the stop condition (success OR rejection)?

Call the reflect tool with your evaluation.`;

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

ANGLES EXPLORED:
${reviewMemory?.angles?.map((a, idx) => `${idx}. ${a.name} [${a.status.toUpperCase()}]${a.result ? ` - ${a.result}` : ''}`).join('\n') || 'None'}

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
