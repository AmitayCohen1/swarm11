import { ToolLoopAgent, stepCountIs, hasToolCall, tool } from 'ai';
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
**DECISION:** what to do next

TRACK YOUR PROGRESS - use operations array to update the list:

LIST STRUCTURE EXAMPLE:
  0. "Find top podcast networks"           [ACTIVE]
     0.0 "What are their listener counts?"    [pending]
     0.1 "Who are the content leads?"         [pending]
  1. "Find fact-check tool vendors"        [pending]

OPERATIONS:
  Mark done:   {action: "done", target: 0}       → initiative done
  Mark done:   {action: "done", target: "0.1"}   → subtask done
  Add subtask: {action: "add", target: "0.2", item: "What's their revenue?"}
  Remove:      {action: "remove", target: 1}     → delete initiative

USE SUBTASKS when an you want to drill down on a specific topic.
Each subtask = one specific question.

New items must be SPECIFIC:
✅ "Who is Head of Content at iHeartMedia?"
❌ "Research buyer personas" (too vague)

Research rellenlesy until you have either a really good result or you looked in any place, any direction, and there is no more to look.


Set done=true when you have enough to answer the objective.
When done=true, you'll be told to call finish() with your final answer.`,
    inputSchema: z.object({
      reflection: z.string().describe('**LEARNED:** facts found. **DECISION:** next action. **OPERATIONS:** list of operations to perform on the initiative list.'),
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

        // Emit event showing what operations were performed
        const opsSummary = [
          ...removes.map(op => `✓ done: ${typeof op.target === 'number' ? list[op.target]?.item?.substring(0, 30) : op.target}`),
          ...dones.map(op => `✓ done: ${typeof op.target === 'number' ? list[op.target]?.item?.substring(0, 30) : op.target}`),
          ...adds.map(op => `+ add: "${op.item?.substring(0, 30)}..."`)
        ];
        if (opsSummary.length > 0) {
          onProgress?.({
            type: 'list_operations',
            operations: operations,
            summary: opsSummary
          });
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

      // Tell the model whether research is complete
      if (actualDone && pendingCount === 0) {
        console.log('[Research] reflect() complete - research done, model should call finish()');
        onProgress?.({
          type: 'reflect_completed',
          decision: 'finishing',
          pendingCount: 0,
          doneCount: list.length
        });
        return {
          status: 'complete',
          instruction: 'Research complete. Call finish() with your final answer.',
          summary: `All ${doneCount} initiatives done.`,
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
        status: 'continue',
        instruction: `Continue researching. Next: "${nextActive}"`,
        summary: `Progress: ${doneCount}/${list.length} initiatives, ${doneSubtasks}/${totalSubtasks} subtasks.`,
        currentList: listState
      };
    }
  });

  // Finish tool - signals research completion (triggers hasToolCall('finish') stop condition)
  const finishTool = tool({
    description: `Call when you have enough information to answer the research objective.

WHEN TO CALL:
- All initiatives are marked done, OR
- You have enough data to answer even if some initiatives remain
- reflect() told you research is complete

DO NOT CALL if you still need more information.

Provide your final synthesized answer addressing the objective.`,
    inputSchema: z.object({
      confidenceLevel: z.enum(['low', 'medium', 'high']).describe('How confident are you in the completeness?'),
      finalAnswer: z.string().describe('Complete answer to the research objective - concise and actionable')
    }),
    execute: async ({ confidenceLevel, finalAnswer }) => {
      console.log(`[Research] FINISH called - confidence: ${confidenceLevel}`);
      setPhase('synthesizing', null);
      onProgress?.({ type: 'synthesizing_started' });

      // Auto-complete all remaining initiatives (clears loading state in UI)
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let memory = parseResearchMemory(session?.brain || '');
      if (memory?.explorationList) {
        for (const item of memory.explorationList) {
          item.done = true;
          if (item.subtasks) {
            for (const sub of item.subtasks) {
              sub.done = true;
            }
          }
        }

        const serializedBrain = serializeResearchMemory(memory);
        await db
          .update(chatSessions)
          .set({ brain: serializedBrain, updatedAt: new Date() })
          .where(eq(chatSessions.id, chatSessionId));

        // Send final list state to UI (all done)
        onProgress?.({ type: 'list_updated', list: memory.explorationList });
        onProgress?.({ type: 'brain_update', brain: serializedBrain });
      }

      // Return the answer - loop will stop due to hasToolCall('finish')
      return { confidenceLevel, finalAnswer };
    }
  });

  const tools = {
    plan: planTool,
    search,
    reflect: reflectionTool,
    finish: finishTool,
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
WORKFLOW: plan() → search() → reflect() → [repeat or finish()]

When reflect() returns status="complete", call finish() with your final answer.
`;


  // Track tool call sequence for logging
  const toolSequence: string[] = [];

  try {
    console.log('[Research] Starting ToolLoopAgent for objective:', researchBrief.objective.substring(0, 50) + '...');

    const agent = new ToolLoopAgent({
      model: openai('gpt-4.1'),
      instructions,
      tools,
      // No Output.object - answer comes from finish() tool
      stopWhen: [hasToolCall('finish'), stepCountIs(MAX_STEPS)],
      abortSignal,

      // Enforce tool ordering: plan → search → reflect → (search or finish)
      prepareStep: async ({ steps }: { steps: any[] }) => {
        const allToolCalls = steps.flatMap((s: any) => s.toolCalls || []);
        const lastTool = allToolCalls.at(-1)?.toolName;
        const hasPlan = allToolCalls.some((t: any) => t.toolName === 'plan');

        // Step 0 or no plan yet: force plan
        if (!hasPlan) {
          console.log('[Research] prepareStep: forcing plan');
          return {
            activeTools: ['plan'] as const,
            toolChoice: { type: 'tool' as const, toolName: 'plan' }
          };
        }

        // After search: force reflect
        if (lastTool === 'search') {
          console.log('[Research] prepareStep: forcing reflect (after search)');
          return {
            activeTools: ['reflect'] as const,
            toolChoice: { type: 'tool' as const, toolName: 'reflect' }
          };
        }

        // After plan: force search
        if (lastTool === 'plan') {
          console.log('[Research] prepareStep: forcing search (after plan)');
          return {
            activeTools: ['search'] as const,
            toolChoice: { type: 'tool' as const, toolName: 'search' }
          };
        }

        // After reflect: allow search OR finish (model decides based on done flag)
        if (lastTool === 'reflect') {
          console.log('[Research] prepareStep: allowing search or finish (after reflect)');
          return {
            activeTools: ['search', 'finish'] as const
          };
        }

        // Default: all tools available
        console.log('[Research] prepareStep: default - all tools');
        return {};
      },

      onStepFinish: async (step: any) => {
        const { toolCalls, toolResults, usage } = step || {};
        stepCounter += 1;

        // Track tool sequence
        const toolNames = toolCalls?.map((t: any) => t.toolName) || [];
        toolSequence.push(...toolNames);

        // Log the sequence so far
        console.log(`[Research] Step ${stepCounter} | Tools: [${toolNames.join(', ')}] | Sequence so far: ${toolSequence.join(' → ')}`);

        // Check if we should stop (user cancelled)
        const [sessionCheck] = await db
          .select({ status: chatSessions.status })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        if (sessionCheck?.status !== 'researching') {
          throw new Error('Research stopped by user');
        }

        // Track credits
        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;

        // Emit progress
        onProgress?.({
          type: 'research_iteration',
          iteration: stepCounter,
          phase: currentPhase,
          activeInitiative,
          cycle: cycleCounter,
          searchCount,
          toolSequence: [...toolSequence],
          creditsUsed: totalCreditsUsed,
          tokensUsed: usage?.totalTokens || 0
        });

        // Process tool calls
        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            const input = (toolCall as any).input;

            if (toolName === 'plan') {
              setPhase('planning');
              console.log(`[Research] PLAN called with ${input?.list?.length || 0} initiatives`);
            } else if (toolName === 'search') {
              setPhase('searching', activeInitiative);
              const queries = input?.queries || [];
              searchCount += queries.length;
              console.log(`[Research] SEARCH called with ${queries.length} queries (total: ${searchCount})`);
              onProgress?.({
                type: 'search_started',
                count: queries.length,
                totalSearches: searchCount,
                activeInitiative,
                cycle: cycleCounter,
                queries: queries.map((q: any) => ({ query: q.query, purpose: q.purpose }))
              });
            } else if (toolName === 'reflect') {
              setPhase('reflecting');
              console.log(`[Research] REFLECT called, done=${input?.done}`);
              onProgress?.({ type: 'reasoning_started' });
            }
          }
        }

        // Process tool results
        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            const toolResult = (result as any).output;

            if (toolName === 'search') {
              const searchResults = toolResult?.results || [];
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

              // Track searches in memory
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
            }

            // Log reflect status
            if (toolName === 'reflect') {
              const status = toolResult?.status;
              console.log(`[Research] onStepFinish: reflect returned status=${status}`);
            }

            // Log finish tool result
            if (toolName === 'finish') {
              console.log(`[Research] onStepFinish: finish called - confidence=${toolResult?.confidenceLevel}`);
            }
          }
        }
      }
    } as any);

    // Build context from conversation history
    let contextPrompt = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-5);
      contextPrompt = '\n\nCONVERSATION CONTEXT:\n';
      recentMessages.forEach((msg: any) => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      contextPrompt += '\n';
    }

    console.log('[Research] Calling agent.generate()...');
    const result = await agent.generate({
      prompt: `${contextPrompt}Execute the research. Follow tool descriptions carefully.`
    });

    // Log final tool sequence
    console.log(`[Research] ═══════════════════════════════════════════════════`);
    console.log(`[Research] FINAL TOOL SEQUENCE: ${toolSequence.join(' → ')}`);
    console.log(`[Research] Total steps: ${stepCounter}, Searches: ${searchCount}`);
    console.log(`[Research] ═══════════════════════════════════════════════════`);

    // Emit final sequence to UI
    onProgress?.({
      type: 'research_complete',
      toolSequence,
      totalSteps: stepCounter,
      totalSearches: searchCount
    });

    // Extract answer from finish() tool call
    const allSteps = result.steps || [];
    const finishToolResult = allSteps
      .flatMap((s: any) => s.toolResults || [])
      .find((r: any) => r.toolName === 'finish');

    // Tool results use .output property (same as in onStepFinish)
    const output = (finishToolResult as any)?.output || {
      confidenceLevel: 'low',
      finalAnswer: result.text || 'Research completed but no answer extracted.'
    };

    console.log(`[Research] Completed! Confidence: ${output.confidenceLevel}`);

    return {
      completed: true,
      iterations: stepCounter,
      creditsUsed: totalCreditsUsed,
      toolSequence,
      output
    };

  } catch (error) {
    console.error('Research execution error:', error);
    console.log(`[Research] FAILED - Tool sequence before error: ${toolSequence.join(' → ')}`);
    throw error;
  }
}
