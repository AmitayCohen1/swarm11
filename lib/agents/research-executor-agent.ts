import { ToolLoopAgent, Output, stepCountIs, tool } from 'ai';
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
    description: 'CALL FIRST before any searches. Set your initial exploration list - what you plan to investigate.',
    inputSchema: z.object({
      list: z.array(z.object({
        item: z.string().describe('Short description of what to investigate'),
        done: z.boolean().describe('Whether this item is completed'),
        subtasks: z.array(z.object({
          item: z.string(),
          done: z.boolean()
        })).optional().describe('Optional subtasks under this item')
      })).describe('Initial exploration list - things you plan to investigate.')
    }),
    execute: async ({ list }) => {
      // Send list to UI
      onProgress?.({
        type: 'list_updated',
        list
      });

      // Load current memory and save list
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
      return { acknowledged: true, currentList: lines.join('\n') };
    }
  });

  const reflectionTool = tool({
    description: 'MANDATORY after every search. Analyze results, update the exploration list. Use dot notation for subtasks (e.g., "0.1").',
    inputSchema: z.object({
      reflection: z.string().describe('Markdown formatted. Two sections: **Learned:** specific facts, names, numbers. **Next:** where to drill deeper. Use bullet points for clarity.'),
      operations: z.array(z.object({
        action: z.enum(['done', 'remove', 'add']).describe('What to do'),
        target: z.union([z.number(), z.string()]).describe('Index: number for top-level (0, 1), string for subtask ("0.0", "0.1")'),
        item: z.string().optional().describe('Required for "add" action - the item text')
      })).optional().describe('List operations. Examples: {action:"done",target:0}, {action:"add",target:"0.1",item:"New subtask"}'),
      done: z.boolean().describe('ONLY set true when ALL list items are done AND you can answer the objective. If items remain pending, must be false.')
    }),
    execute: async ({ reflection, operations, done }) => {
      console.log(`[Research] reflect() called - reflection: ${reflection.substring(0, 50)}..., ops: ${operations?.length || 0}, done: ${done}`);

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

      // Process operations in order (agent controls the sequence)
      if (operations && operations.length > 0) {
        // Group by action type and process: remove first, then done, then add
        const removes = operations.filter(op => op.action === 'remove');
        const dones = operations.filter(op => op.action === 'done');
        const adds = operations.filter(op => op.action === 'add');

        // Process removes (reverse order to preserve indices)
        const sortedRemoves = [...removes].sort((a, b) => {
          const pa = parseTarget(a.target);
          const pb = parseTarget(b.target);
          if (pa.parent !== pb.parent) return pb.parent - pa.parent;
          return (pb.sub ?? -1) - (pa.sub ?? -1);
        });
        for (const op of sortedRemoves) {
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            // Remove subtask
            if (list[parent]?.subtasks && sub >= 0 && sub < list[parent].subtasks.length) {
              list[parent].subtasks.splice(sub, 1);
            }
          } else {
            // Remove top-level
            if (parent >= 0 && parent < list.length) {
              list.splice(parent, 1);
            }
          }
        }

        // Process dones
        for (const op of dones) {
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            // Mark subtask done
            if (list[parent]?.subtasks?.[sub]) {
              list[parent].subtasks[sub].done = true;
            }
          } else {
            // Mark top-level done
            if (list[parent]) {
              list[parent].done = true;
            }
          }
        }

        // Process adds
        for (const op of adds) {
          if (!op.item) continue;
          const { parent, sub } = parseTarget(op.target);
          if (sub !== undefined) {
            // Add subtask
            if (list[parent]) {
              if (!list[parent].subtasks) list[parent].subtasks = [];
              const insertAt = Math.min(Math.max(0, sub), list[parent].subtasks.length);
              list[parent].subtasks.splice(insertAt, 0, { item: op.item, done: false });
            }
          } else {
            // Add top-level
            const insertAt = Math.min(Math.max(0, parent), list.length);
            list.splice(insertAt, 0, { item: op.item, done: false });
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

      // Signal completion to stop the loop (only if truly done AND no pending items)
      if (actualDone && pendingCount === 0) {
        console.log('[Research] reflect() complete - research done, shouldStop=true');
        onProgress?.({ type: 'synthesizing_started' });
        return {
          acknowledged: true,
          shouldStop: true,
          currentList: listState
        };
      }

      console.log('[Research] reflect() complete - continuing research');
      return {
        acknowledged: true,
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
You are an Autonomous Research Agent operating in an iterative reasoning loop.
Your objective is to reduce uncertainty for the research brief by discovering, validating, and synthesizing high-signal evidence.

═══════════════════════════════════════════════════════════════
RESEARCH BRIEF FROM ORCHESTRATOR
═══════════════════════════════════════════════════════════════

OBJECTIVE:
${researchBrief.objective}

STOPPING CONDITIONS:
${researchBrief.stoppingConditions}

SUCCESS CRITERIA:
${researchBrief.successCriteria}
${researchBrief.outputFormat ? `\nPREFERRED OUTPUT FORMAT:\n${researchBrief.outputFormat}` : ''}
${existingBrain ? `
═══════════════════════════════════════════════════════════════
PREVIOUS RESEARCH IN THIS SESSION
═══════════════════════════════════════════════════════════════

${formatForOrchestrator(parseResearchMemory(existingBrain), 5000)}

Use this context. Don't repeat searches that already ran. Build on existing findings.
` : ''}
═══════════════════════════════════════════════════════════════
OPERATING PRINCIPLES
═══════════════════════════════════════════════════════════════

• Optimize for signal density, not information volume
• Prefer observable behavior and external validation over stated claims
• Actively seek disconfirming evidence

═══════════════════════════════════════════════════════════════
RESEARCH LOOP
═══════════════════════════════════════════════════════════════

You can run hours to find what you need. Don't rush.

1. EXPLORE: Begin with broad exploration to identify promising signal directions
2. FILTER: Rapidly discard low-signal material (self-descriptions, repetition, inactivity, unverified claims)
3. NARROW: Progressively drill down and focus on the strongest signals

═══════════════════════════════════════════════════════════════
TOOLS
═══════════════════════════════════════════════════════════════

plan({list}):
• CALL FIRST before any searches
• Start with just 1-2 items - you're autonomous, add more as you discover
• Don't try to plan everything upfront - the list grows organically

search({queries}):
• Takes 1-3 queries, runs them in parallel
• Each query: {query: "full question", purpose: "what this tests"}

reflect({reflection, operations?, done}):
• MANDATORY after each search()
• reflection: Markdown formatted with two sections:
  **Learned:** - bullet points of facts, names, numbers
  **Next:** - where to drill deeper
• operations: Array of {action, target, item?} - see below
• done: Set true when you have enough to answer

CYCLE: plan() → search() → reflect() → search() → reflect() → ... → done

═══════════════════════════════════════════════════════════════
EXPLORATION LIST - DRILL DOWN STRATEGY
═══════════════════════════════════════════════════════════════

START BROAD, DRILL DOWN:
1. Begin with 2-3 main questions (high-level themes to explore)
2. Search each main question broadly
3. Based on findings, ADD SUBTASKS to drill deeper into specific areas
4. Mark items done as you complete them
5. First pending item/subtask = ACTIVE (what you work on next)

IMPORTANT: Do NOT include indices in item text. Just the description.
  ❌ Bad: "0.1 Find podcasts..."
  ✅ Good: "Find podcasts..."
  The system tracks indices automatically.

EXAMPLE FLOW:
  Start: "Find leads for podcast fact-checking tool"

  Initial plan:
    0. Who has misinformation problems? [ACTIVE]
    1. Who would pay for solutions?

  After first search, add subtasks:
    0. Who has misinformation problems? [done]
       0.0 News/politics podcasts [ACTIVE]
       0.1 Health/finance podcasts [pending]
    1. Who would pay for solutions?

  Continue drilling:
    0. Who has misinformation problems? [done]
       0.0 News/politics podcasts [done]
       0.1 Health/finance podcasts [ACTIVE]
    1. Who would pay for solutions?
       1.0 Media organizations [pending]
       1.1 Podcast networks [pending]

OPERATIONS:
  {action: "done", target: 0}              → mark main item done
  {action: "done", target: "0.1"}          → mark subtask done
  {action: "add", target: "0.0", item: "X"} → add subtask under item 0
  {action: "add", target: 2, item: "X"}    → add new main item
  {action: "remove", target: "0.1"}        → remove subtask (if irrelevant)

Operations apply in order: remove → done → add

═══════════════════════════════════════════════════════════════
CHANGE & TIMING SIGNALS
═══════════════════════════════════════════════════════════════

• Actively look for momentum, disengagement, transition, or contradiction over time
• Treat recent changes as higher-weight signals

═══════════════════════════════════════════════════════════════
STOPPING CONDITIONS (IMPORTANT!)
═══════════════════════════════════════════════════════════════

You may ONLY set done=true when BOTH conditions are met:
1. ALL exploration list items are marked done (no pending items/subtasks)
2. You have gathered enough information to answer the objective

If items remain pending → keep researching, do NOT set done=true
If you need to skip an item → remove it with {action:"remove"}, don't just ignore it

═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════

• Surface only the most meaningful findings
• Explain why each finding matters
• Explicitly flag weak signals, assumptions, and contradictions
• If the brief cannot be satisfied, specify exactly which signal is missing
• If a preferred format was specified, use it (table, bullet list, etc.)
• Default: use the format that best fits the data (tables for comparisons, lists for options)

═══════════════════════════════════════════════════════════════
CONSTRAINTS
═══════════════════════════════════════════════════════════════

• You are a reasoning agent, not a search engine
• Your success is measured by how clearly a decision can be made from your output

TOOLS:
• plan(list): CALL FIRST. Set initial exploration list (1-2 items).
• search(queries): Run queries in parallel. Each needs {query, purpose}.
• reflect(learned, operations?, done): MANDATORY after search. Use operations array for list changes.
• askUser(question, options): Only if genuinely blocked.

═══════════════════════════════════════════════════════════════
UNCERTAINTY INVARIANT
═══════════════════════════════════════════════════════════════

If available evidence does not uniquely support one conclusion,
the agent must preserve uncertainty rather than resolve it.
Uncertainty is a valid output.
`;


  try {
    console.log('[Research] Starting research execution for objective:', researchBrief.objective.substring(0, 50) + '...');
    const agent = new ToolLoopAgent({
      model: openai('gpt-5.1'),
      instructions,
      tools,
      output: Output.object({ schema: ResearchOutputSchema }),
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      onStepFinish: async (step: any) => {
        const { toolCalls, toolResults, usage } = step || {};
        stepCounter += 1;

        console.log(`[Research] Step ${stepCounter} finished. Tools called:`, toolCalls?.map((t: any) => t.toolName) || 'none');

        const [sessionCheck] = await db
          .select({ status: chatSessions.status })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        if (sessionCheck?.status !== 'researching') {
          throw new Error('Research stopped by user');
        }

        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;

        onProgress?.({
          type: 'research_iteration',
          iteration: stepCounter,
          creditsUsed: totalCreditsUsed,
          tokensUsed: usage?.totalTokens || 0
        });

        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            const input = (toolCall as any).input;

            console.log(`[Research] Tool call: ${toolName}`);
            if (toolName === 'search') {
              const queries = input?.queries || [];
              console.log(`[Research] search() starting with ${queries.length} queries`);
              onProgress?.({
                type: 'search_started',
                count: queries.length,
                queries: queries.map((q: any) => ({ query: q.query, purpose: q.purpose }))
              });
            } else if (toolName === 'reflect') {
              console.log('[Research] reflect() starting');
              onProgress?.({
                type: 'reasoning_started'
              });
            }
          }
        }

        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            const toolResult = (result as any).output;

            if (toolName === 'search') {
              console.log('[Research] search() results received');
              // Emit all results at once to avoid race conditions
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
                queries: completedQueries
              });

              // Track searches in structured memory
              const [session] = await db
                .select({ brain: chatSessions.brain })
                .from(chatSessions)
                .where(eq(chatSessions.id, chatSessionId));

              let memory = parseResearchMemory(session?.brain || '');
              if (memory) {
                // Ensure we have an active cycle
                if (memory.cycles.length === 0) {
                  memory = startCycle(memory, 'Initial research exploration');
                }

                // Add each search result to the current cycle and save to DB
                for (const sq of completedQueries) {
                  const searchEntry: SearchResult = {
                    query: sq.query,
                    purpose: sq.purpose,
                    answer: sq.answer,
                    sources: sq.sources
                  };
                  memory = addSearchToMemory(memory, searchEntry);

                  // Save to normalized search_queries table
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
          }
        }
      }
    } as any);

    // Build context from conversation history
    let contextPrompt = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-5); // Last 5 messages for context
      contextPrompt = '\n\nCONVERSATION CONTEXT:\n';
      recentMessages.forEach((msg: any) => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      contextPrompt += '\n';
    }

    console.log('[Research] Calling agent.generate()...');
    const result = await agent.generate({
      prompt: `${contextPrompt}Execute the research brief above.

STRATEGY: Start broad, drill down with subtasks.

1. plan() - Start with 2-3 MAIN QUESTIONS (broad themes)
2. search() - Explore each main question
3. reflect() - Add SUBTASKS to drill deeper into what you found

Example flow:
  plan: ["Who needs this?", "Who would pay?"]
  → search main question
  → reflect: add subtasks like "0.0 Media orgs", "0.1 Podcast networks"
  → search subtask
  → reflect: mark done, move to next
  → continue until objective met

CRITICAL: Use FULL natural language questions in search.
✅ Good: "What are the most popular finance podcasts in 2024?"
❌ Bad: "finance podcasts 2024"

In reflect, use operations array:
  {action: "done", target: 0}              → mark item done
  {action: "add", target: "0.0", item: "X"} → add subtask

IMPORTANT: Keep done=false until ALL list items are completed. Work through every item.`
    });

    // Structured output from AI SDK 6 - typed by ResearchOutputSchema
    const output = result.output;
    console.log(`[Research] Completed! Steps: ${result.steps?.length || 0}, Output confidence: ${(output as any)?.confidenceLevel}`);

    return {
      completed: true,
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed,
      output // { confidenceLevel, finalAnswer }
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
