import { generateText, generateObject, tool } from 'ai';
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
  hasQueryBeenRun,
  formatForOrchestrator
} from '@/lib/utils/research-memory';
import type { ResearchMemory, SearchResult, ExplorationItem } from '@/lib/types/research-memory';
// import { deductCredits } from '@/lib/credits'; // POC: Disabled for free usage

// Schema for structured research output
const ResearchOutputSchema = z.object({
  confidenceLevel: z.enum(['low', 'medium', 'high']).describe('Confidence in the completeness of findings'),
  finalAnswer: z.string().describe('Complete answer, concise and actionable')
});

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
 * Research Executor Agent - Uses ToolLoopAgent for multi-step autonomous research
 * Receives a structured ResearchBrief from the Orchestrator
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

  let totalCreditsUsed = 0;
  const MAX_STEPS = 100;
  let stepCounter = 0;
  let cycleCounter = 1;
  let currentPhase: 'planning' | 'searching' | 'reflecting' | 'synthesizing' = 'planning';
  let activeInitiative: string | null = null;
  let searchCount = 0;

  // Helper to emit phase changes
  const setPhase = (phase: typeof currentPhase, initiative?: string | null) => {
    currentPhase = phase;
    if (initiative !== undefined) activeInitiative = initiative ?? null;
    onProgress?.({
      type: 'phase_change',
      phase: currentPhase,
      activeInitiative,
      cycle: cycleCounter,
      searchCount
    });
  };

  const askUserTool = tool({
    description: 'Ask the user a question with selectable options. Use this to clarify goals, narrow focus, or get decisions.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask - keep spesific and to the point'),
      options: z.array(z.object({
        label: z.string().describe('Short label for the option (2-5 words)'),
        description: z.string().optional().describe('Optional longer description')
      })).min(2).max(5).describe('2-5 options for the user to choose from')
    }),
    execute: async ({ question, options }) => {
      onProgress?.({
        type: 'ask_user',
        question,
        options
      });

      return {
        acknowledged: true,
        note: 'Question sent with options. Wait for user selection before continuing.'
      };
    }
  });

  const planTool = tool({
    description: `Create your research plan. CALL THIS FIRST.

Create 1-2 initiatives. Each must be:
- SINGLE QUESTION: One specific thing to find out
- STANDALONE: No "within those" or "based on above"
- SEARCHABLE: Can be answered with 1-3 web searches

GOOD INITIATIVES (specific, single-question):
✅ "Which podcast networks have over 10M monthly listeners?"
✅ "What companies sell content moderation tools to media?"
✅ "Who are the hosts of top news podcasts?"

BAD INITIATIVES (too broad, vague, or dependent):
❌ "Identify buyer personas and gather data for outreach" (too broad - multiple tasks)
❌ "Within those organizations, find decision makers" (dependent on prior context)
❌ "Research the podcast industry landscape" (too vague - not a specific question)
❌ "Understand customer segments and their pain points" (multiple questions bundled)

RULE: If an initiative has "and" in it, it's probably too broad. Split it.

Start with 1-2 narrow initiatives. Add more via reflect() as you learn.`,
    inputSchema: z.object({
      list: z.array(z.object({
        item: z.string().describe('SPECIFIC single-question initiative. No "and". e.g. "Which podcast networks have 10M+ listeners?"'),
        done: z.boolean().default(false),
        subtasks: z.array(z.object({
          item: z.string().describe('Specific sub-question'),
          done: z.boolean().default(false)
        })).optional()
      })).min(1).max(2).describe('1-2 focused initiatives to start')
    }),
    execute: async ({ list }) => {
      onProgress?.({ type: 'plan_started' });

      // Load current memory first to check if plan already exists
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');

      // Prevent re-planning if exploration list already exists
      if (memory?.explorationList && memory.explorationList.length > 0) {
        console.log('[Research] WARNING: Agent tried to call plan() again. Blocked to prevent list wipe.');
        // Return current list state so agent knows what exists
        const currentList = memory.explorationList;
        let firstPendingFound = false;
        const lines: string[] = ['⚠️ Plan already exists. Use reflect() operations to modify the list.', '', 'Current list:'];
        for (let idx = 0; idx < currentList.length; idx++) {
          const item = currentList[idx];
          let status = item.done ? 'done' : (!firstPendingFound ? (firstPendingFound = true, 'ACTIVE') : 'pending');
          lines.push(`${idx}. ${item.item} [${status}]`);
          if (item.subtasks) {
            for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
              const sub = item.subtasks[subIdx];
              lines.push(`  ${idx}.${subIdx} ${sub.item} [${sub.done ? 'done' : 'pending'}]`);
            }
          }
        }
        return lines.join('\n');
      }

      // Send list to UI
      onProgress?.({
        type: 'list_updated',
        list
      });

      if (!memory) {
        memory = {
          version: 1,
          objective: researchBrief.objective,
          successCriteria: researchBrief.successCriteria,
          cycles: [],
          queriesRun: []
        };
      }

      memory.explorationList = list;

      const serializedBrain = serializeResearchMemory(memory);

      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: serializedBrain });

      // Return numbered list for agent context (first pending = ACTIVE)
      let firstPendingFound = false;
      const lines: string[] = [];
      for (let idx = 0; idx < list.length; idx++) {
        const item = list[idx];
        let status = item.done ? 'done' : (!firstPendingFound ? (firstPendingFound = true, 'ACTIVE') : 'pending');
        lines.push(`${idx}. ${item.item} [${status}]`);
        if (item.subtasks) {
          for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
            const sub = item.subtasks[subIdx];
            let subStatus = sub.done ? 'done' : (!firstPendingFound ? (firstPendingFound = true, 'ACTIVE') : 'pending');
            lines.push(`   ${idx}.${subIdx} ${sub.item} [${subStatus}]`);
          }
        }
      }

      // Find first active initiative
      const firstActive = list.find(i => !i.done)?.item || list[0]?.item;
      setPhase('searching', firstActive);
      onProgress?.({
        type: 'plan_completed',
        initiativeCount: list.length,
        activeInitiative: firstActive
      });

      return { acknowledged: true, currentList: lines.join('\n') };
    }
  });

  const reflectionTool = tool({
    description: `Analyze what you learned. MANDATORY after every search.

REFLECTION FORMAT:
**LEARNED:** specific facts, names, numbers found
**DECISION:** what to do next (keep searching / mark done / add subtask / finish)

OPERATIONS (optional - modify the initiative list):
  {action: "done", target: 0}           → mark initiative 0 complete
  {action: "done", target: "0.1"}       → mark subtask complete
  {action: "remove", target: 1}         → delete initiative (if not needed)
  {action: "add", target: "0.0", item: "..."} → add subtask under initiative 0

ADDING NEW INITIATIVES - must be SPECIFIC & SINGLE-QUESTION:
✅ "Find the top 5 podcast networks by revenue"
✅ "Who is the Head of Content at iHeartMedia?"
❌ "Research buyer personas and outreach angles" (too broad)
❌ "Within those companies, identify..." (not standalone)

WHEN TO SET done=true:
- You have enough to answer the objective (doesn't need to be perfect)
- Remove initiatives you don't need rather than completing everything`,
    inputSchema: z.object({
      reflection: z.string().describe('**LEARNED:** facts found. **DECISION:** next action.'),
      operations: z.array(z.object({
        action: z.enum(['done', 'remove', 'add']),
        target: z.union([z.number(), z.string()]).describe('0 for main initiative, "0.1" for subtask'),
        item: z.string().optional().describe('For add: SPECIFIC single-question initiative. No "and", no "within those".')
      })).optional(),
      done: z.boolean().describe('true = have enough to answer, false = keep researching')
    }),
    execute: async ({ reflection, operations, done }) => {
      console.log(`[Research] reflect() called - reflection: ${reflection.substring(0, 50)}..., ops: ${operations?.length || 0}, done: ${done}`);
      setPhase('reflecting');

      // Send reasoning to UI
      onProgress?.({
        type: 'reasoning',
        reflection
      });

      // Load current memory from brain
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');

      // If no memory exists, create one (shouldn't happen but be safe)
      if (!memory) {
        memory = {
          version: 1,
          objective: researchBrief.objective,
          successCriteria: researchBrief.successCriteria,
          cycles: [],
          queriesRun: []
        };
      }

      // Deep clone to avoid mutation issues
      let list: ExplorationItem[] = JSON.parse(JSON.stringify(memory.explorationList || []));

      // Helper to parse target (number or "0.1" string)
      const parseTarget = (target: number | string): { parent: number; sub?: number } => {
        if (typeof target === 'number') return { parent: target };
        const parts = String(target).split('.');
        return { parent: parseInt(parts[0]), sub: parts[1] !== undefined ? parseInt(parts[1]) : undefined };
      };

      // Process operations: remove → done → add (order matters for index stability)
      if (operations && operations.length > 0) {
        console.log(`[Research] Processing ${operations.length} operations:`, operations);

        const removes = operations.filter(op => op.action === 'remove');
        const dones = operations.filter(op => op.action === 'done');
        const adds = operations.filter(op => op.action === 'add');

        // REMOVE: Process in reverse order to preserve indices
        const sortedRemoves = [...removes].sort((a, b) => {
          const pa = parseTarget(a.target);
          const pb = parseTarget(b.target);
          if (pa.parent !== pb.parent) return pb.parent - pa.parent;
          return (pb.sub ?? -1) - (pa.sub ?? -1);
        });
        for (const op of sortedRemoves) {
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            if (list[parent]?.subtasks && sub >= 0 && sub < list[parent].subtasks.length) {
              const removed = list[parent].subtasks.splice(sub, 1)[0];
              console.log(`[Research] REMOVE subtask ${parent}.${sub}: "${removed.item}"`);
            } else {
              console.log(`[Research] REMOVE subtask ${parent}.${sub}: INVALID INDEX`);
            }
          } else {
            if (parent >= 0 && parent < list.length) {
              const removed = list.splice(parent, 1)[0];
              console.log(`[Research] REMOVE initiative ${parent}: "${removed.item}"`);
            } else {
              console.log(`[Research] REMOVE initiative ${parent}: INVALID INDEX`);
            }
          }
        }

        // DONE: Mark items as completed
        for (const op of dones) {
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            if (list[parent]?.subtasks?.[sub]) {
              list[parent].subtasks[sub].done = true;
              console.log(`[Research] DONE subtask ${parent}.${sub}: "${list[parent].subtasks[sub].item}"`);
            } else {
              console.log(`[Research] DONE subtask ${parent}.${sub}: INVALID INDEX`);
            }
          } else {
            if (list[parent]) {
              list[parent].done = true;
              console.log(`[Research] DONE initiative ${parent}: "${list[parent].item}"`);
            } else {
              console.log(`[Research] DONE initiative ${parent}: INVALID INDEX`);
            }
          }
        }

        // ADD: Insert new items
        for (const op of adds) {
          if (!op.item) {
            console.log(`[Research] ADD: SKIPPED - no item provided`);
            continue;
          }
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            // Add as subtask under parent
            if (list[parent]) {
              if (!list[parent].subtasks) list[parent].subtasks = [];
              const insertAt = Math.min(Math.max(0, sub), list[parent].subtasks.length);
              list[parent].subtasks.splice(insertAt, 0, { item: op.item, done: false });
              console.log(`[Research] ADD subtask ${parent}.${insertAt}: "${op.item}"`);
            } else {
              console.log(`[Research] ADD subtask under ${parent}: INVALID PARENT INDEX`);
            }
          } else {
            // Add as main initiative
            const insertAt = Math.min(Math.max(0, parent), list.length);
            list.splice(insertAt, 0, { item: op.item, done: false });
            console.log(`[Research] ADD initiative at ${insertAt}: "${op.item}"`);
          }
        }
      }

      // Send list update to UI
      onProgress?.({
        type: 'list_updated',
        list
      });

      // Complete the current cycle with learnings
      memory = completeCycle(memory, reflection, done ? 'done' : 'continue');

      // Save current exploration list
      memory.explorationList = list;

      // Count pending items (including subtasks)
      let pendingCount = 0;
      for (const item of list) {
        if (!item.done) pendingCount++;
        if (item.subtasks) {
          for (const sub of item.subtasks) {
            if (!sub.done) pendingCount++;
          }
        }
      }

      // Safeguard: if done=true but items are pending, override to false
      let actualDone = done;
      if (done && pendingCount > 0) {
        console.log(`[Research] WARNING: Agent tried to finish with ${pendingCount} pending items. Overriding done=false.`);
        actualDone = false;
      }

      // If not done, start a new cycle
      const pendingItems = list.filter(i => !i.done);
      if (!actualDone && pendingItems.length > 0) {
        memory = startCycle(memory, pendingItems[0].item);
        cycleCounter++;
      }

      const serializedBrain = serializeResearchMemory(memory);

      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: serializedBrain });

      // Return current list state for agent context (numbered, with active marker and subtasks)
      let firstPendingFound = false;
      const lines: string[] = [];

      for (let idx = 0; idx < list.length; idx++) {
        const item = list[idx];
        let status = 'pending';
        if (item.done) {
          status = 'done';
        } else if (!firstPendingFound) {
          // Check if there's a pending subtask first
          const hasPendingSubtask = item.subtasks?.some((s: any) => !s.done);
          if (!hasPendingSubtask) {
            firstPendingFound = true;
            status = 'ACTIVE';
          } else {
            status = 'pending';
          }
        }
        lines.push(`${idx}. ${item.item} [${status}]`);

        // Add subtasks
        if (item.subtasks && item.subtasks.length > 0) {
          for (let subIdx = 0; subIdx < item.subtasks.length; subIdx++) {
            const sub = item.subtasks[subIdx];
            let subStatus = 'pending';
            if (sub.done) {
              subStatus = 'done';
            } else if (!firstPendingFound) {
              firstPendingFound = true;
              subStatus = 'ACTIVE';
            }
            lines.push(`   ${idx}.${subIdx} ${sub.item} [${subStatus}]`);
          }
        }
      }
      const listState = lines.join('\n');

      // Find the next active initiative for tracking
      let nextActive: string | null = null;
      for (const item of list) {
        if (!item.done) {
          // Check subtasks first
          const pendingSub = item.subtasks?.find(s => !s.done);
          if (pendingSub) {
            nextActive = pendingSub.item;
            break;
          }
          nextActive = item.item;
          break;
        }
      }

      // Count completed items
      const doneCount = list.filter(i => i.done).length;
      const totalSubtasks = list.reduce((acc, i) => acc + (i.subtasks?.length || 0), 0);
      const doneSubtasks = list.reduce((acc, i) => acc + (i.subtasks?.filter(s => s.done).length || 0), 0);

      // Signal completion to stop the loop (only if truly done AND no pending items)
      if (actualDone && pendingCount === 0) {
        console.log('[Research] reflect() complete - research done, shouldStop=true');
        setPhase('synthesizing', null);
        onProgress?.({
          type: 'reflect_completed',
          decision: 'finishing',
          pendingCount: 0,
          doneCount: list.length
        });
        onProgress?.({ type: 'synthesizing_started' });
        return {
          acknowledged: true,
          shouldStop: true,
          summary: `Research complete. ${doneCount}/${list.length} initiatives done.`,
          currentList: listState
        };
      }

      console.log('[Research] reflect() complete - continuing research');
      setPhase('searching', nextActive);
      onProgress?.({
        type: 'reflect_completed',
        decision: 'continuing',
        pendingCount,
        doneCount,
        nextInitiative: nextActive
      });
      return {
        acknowledged: true,
        summary: `Progress: ${doneCount}/${list.length} initiatives, ${doneSubtasks}/${totalSubtasks} subtasks. Next: "${nextActive}"`,
        currentList: listState
      };
    }
  });

  const tools = {
    plan: planTool,
    search,
    reflect: reflectionTool,
    askUser: askUserTool
  };

  // Build structured instructions from the research brief
  const instructions = `
You are researching: ${researchBrief.objective}

SUCCESS CRITERIA: ${researchBrief.successCriteria}

OUTPUT FORMAT: ${researchBrief.outputFormat || 'Whatever fits the data best'}
${existingBrain ? `
PREVIOUS RESEARCH:
${formatForOrchestrator(parseResearchMemory(existingBrain), 5000)}
Build on existing findings. Don't repeat searches.
` : ''}
Use the tools available. Each tool has detailed instructions in its description.
Call plan() first, then loop search() → reflect() until done.
`;


  // Helper to check if we should stop
  const checkShouldStop = async () => {
    if (abortSignal?.aborted) throw new Error('Research aborted');

    const [sessionCheck] = await db
      .select({ status: chatSessions.status })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    if (sessionCheck?.status !== 'researching') {
      throw new Error('Research stopped by user');
    }
  };

  // Helper to track search results in memory
  const trackSearchResults = async (searchResult: any) => {
    const searchResults = searchResult?.results || [];
    const completedQueries = searchResults.map((sr: any) => ({
      query: sr.query,
      purpose: sr.purpose,
      answer: sr.answer || '',
      sources: (sr.results || []).map((r: any) => ({
        title: r.title,
        url: r.url
      })),
      status: sr.status === 'success' ? 'complete' : 'error'
    }));

    onProgress?.({
      type: 'search_completed',
      totalSearches: searchCount,
      activeInitiative,
      cycle: cycleCounter,
      queries: completedQueries
    });

    // Track in memory
    const [session] = await db
      .select({ brain: chatSessions.brain })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    let memory = parseResearchMemory(session?.brain || '');
    if (memory) {
      if (memory.cycles.length === 0) {
        memory = startCycle(memory, 'Initial research exploration');
      }

      for (const sq of completedQueries) {
        const searchEntry: SearchResult = {
          query: sq.query,
          purpose: sq.purpose,
          answer: sq.answer,
          sources: sq.sources
        };
        memory = addSearchToMemory(memory, searchEntry);

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

      const serializedBrain = serializeResearchMemory(memory);
      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: serializedBrain });
    }

    return completedQueries;
  };

  try {
    console.log('[Research] Starting research execution for objective:', researchBrief.objective.substring(0, 50) + '...');

    // Build conversation history
    const messages: any[] = [
      { role: 'system', content: instructions }
    ];

    // Add conversation context if any
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-5);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: PLANNING
    // ═══════════════════════════════════════════════════════════════
    console.log('[Research] Phase 1: Planning');
    setPhase('planning');
    onProgress?.({ type: 'research_iteration', iteration: stepCounter, phase: 'planning' });

    messages.push({ role: 'user', content: 'Create your research plan. Call the plan() tool.' });

    const planResult = await generateText({
      model: openai('gpt-5.1'),
      messages,
      tools: { plan: planTool },
      toolChoice: 'required',
      abortSignal
    });

    // Add response messages to history (AI SDK handles formatting)
    messages.push(...planResult.response.messages);

    stepCounter++;
    totalCreditsUsed += Math.ceil((planResult.usage?.totalTokens || 0) / 1000);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: RESEARCH LOOP (search → reflect → repeat)
    // ═══════════════════════════════════════════════════════════════
    console.log('[Research] Phase 2: Research Loop');
    let researchDone = false;

    while (!researchDone && stepCounter < MAX_STEPS) {
      await checkShouldStop();

      // ─────────────────────────────────────────────────────────────
      // SEARCH STEP
      // ─────────────────────────────────────────────────────────────
      console.log(`[Research] Step ${stepCounter + 1}: Searching`);
      setPhase('searching', activeInitiative);

      messages.push({
        role: 'user',
        content: `Search for information about the active initiative. Call the search() tool with human-readable questions.`
      });

      onProgress?.({
        type: 'research_iteration',
        iteration: stepCounter,
        phase: 'searching',
        activeInitiative,
        cycle: cycleCounter,
        searchCount
      });

      const searchStepResult = await generateText({
        model: openai('gpt-5.1'),
        messages,
        tools: { search },
        toolChoice: 'required',
        abortSignal
      });

      // Emit progress and track search results
      for (const step of searchStepResult.steps) {
        for (const toolCall of step.toolCalls as any[]) {
          const queries = toolCall.input?.queries || [];
          searchCount += queries.length;
          onProgress?.({
            type: 'search_started',
            count: queries.length,
            totalSearches: searchCount,
            activeInitiative,
            cycle: cycleCounter,
            queries: queries.map((q: any) => ({ query: q.query, purpose: q.purpose }))
          });
        }
        for (const toolResult of step.toolResults as any[]) {
          await trackSearchResults(toolResult.output);
        }
      }

      // Add response messages to history (AI SDK handles formatting)
      messages.push(...searchStepResult.response.messages);

      stepCounter++;
      totalCreditsUsed += Math.ceil((searchStepResult.usage?.totalTokens || 0) / 1000);

      await checkShouldStop();

      // ─────────────────────────────────────────────────────────────
      // REFLECT STEP
      // ─────────────────────────────────────────────────────────────
      console.log(`[Research] Step ${stepCounter + 1}: Reflecting`);
      setPhase('reflecting');

      messages.push({
        role: 'user',
        content: `Reflect on what you learned. Call the reflect() tool. Set done=true if you have enough to answer the objective.`
      });

      onProgress?.({
        type: 'research_iteration',
        iteration: stepCounter,
        phase: 'reflecting',
        activeInitiative,
        cycle: cycleCounter,
        searchCount
      });
      onProgress?.({ type: 'reasoning_started' });

      const reflectStepResult = await generateText({
        model: openai('gpt-5.1'),
        messages,
        tools: { reflect: reflectionTool },
        toolChoice: 'required',
        abortSignal
      });

      // Check for done flag
      for (const step of reflectStepResult.steps) {
        for (const toolResult of step.toolResults as any[]) {
          if (toolResult.output?.shouldStop) {
            console.log('[Research] Reflect signaled done - exiting loop');
            researchDone = true;
          }
        }
      }

      // Add response messages to history (AI SDK handles formatting)
      messages.push(...reflectStepResult.response.messages);

      stepCounter++;
      totalCreditsUsed += Math.ceil((reflectStepResult.usage?.totalTokens || 0) / 1000);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: SYNTHESIZE FINAL ANSWER
    // ═══════════════════════════════════════════════════════════════
    console.log('[Research] Phase 3: Synthesizing final answer');
    setPhase('synthesizing');
    onProgress?.({ type: 'synthesizing_started' });

    messages.push({
      role: 'user',
      content: `Research complete. Provide your final answer based on everything you learned. Be concise and actionable.`
    });

    const synthesizeResult = await generateObject({
      model: openai('gpt-5.1'),
      messages,
      schema: ResearchOutputSchema,
      abortSignal
    });

    totalCreditsUsed += Math.ceil((synthesizeResult.usage?.totalTokens || 0) / 1000);

    console.log(`[Research] Completed! Steps: ${stepCounter}, Confidence: ${synthesizeResult.object.confidenceLevel}`);

    return {
      completed: true,
      iterations: stepCounter,
      creditsUsed: totalCreditsUsed,
      output: synthesizeResult.object
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
