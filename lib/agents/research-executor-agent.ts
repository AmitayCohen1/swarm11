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
import type { ResearchMemory, SearchResult } from '@/lib/types/research-memory';
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
      list: z.array(z.string()).describe('Initial exploration list - things you plan to investigate to answer the objective.')
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

      return { acknowledged: true, list };
    }
  });

  const reflectionTool = tool({
    description: 'MANDATORY after every search. Analyze results, update the exploration list, mark done when finished.',
    inputSchema: z.object({
      learned: z.string().describe('What did we learn from this search? Be specific: names, numbers, facts.'),
      list: z.array(z.string()).describe('Updated exploration list - things still to investigate. Add new items discovered, remove completed ones.'),
      done: z.boolean().describe('Set to true when research is complete and you have enough to answer the objective.')
    }),
    execute: async ({ learned, list, done }) => {
      // Send list update to UI
      onProgress?.({
        type: 'list_updated',
        list
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

      // Complete the current cycle with learnings
      memory = completeCycle(memory, learned, done ? 'done' : 'continue');

      // Save current exploration list
      memory.explorationList = list;

      // If not done, start a new cycle
      if (!done && list.length > 0) {
        memory = startCycle(memory, list[0]); // Next cycle intent = first item
        cycleCounter++;
      }

      const serializedBrain = serializeResearchMemory(memory);

      await db
        .update(chatSessions)
        .set({ brain: serializedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: serializedBrain });

      // Signal completion to stop the loop
      if (done || list.length === 0) {
        onProgress?.({ type: 'synthesizing_started' });
        return {
          acknowledged: true,
          shouldStop: true
        };
      }

      return { acknowledged: true };
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

${formatForOrchestrator(parseResearchMemory(existingBrain), 1500)}

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
• Set your initial exploration list
• What do you plan to investigate to answer the objective?

search({queries}):
• Takes 1-3 queries, runs them in parallel
• Each query: {query: "full question", purpose: "what this tests"}

reflect({learned, list, done}):
• MANDATORY after each search()
• learned: What did you learn?
• list: Updated exploration list (remove done items, add new discoveries)
• done: Set true when you have enough to answer

CYCLE: plan() → search() → reflect() → search() → reflect() → ... → done

═══════════════════════════════════════════════════════════════
EXPLORATION LIST
═══════════════════════════════════════════════════════════════

You maintain a dynamic list of things to investigate.

1. Start with plan() - declare what you want to explore
2. After each search, update via reflect():
   • Remove completed items
   • Add new leads discovered
3. When list is empty or you have enough, set done=true

═══════════════════════════════════════════════════════════════
CHANGE & TIMING SIGNALS
═══════════════════════════════════════════════════════════════

• Actively look for momentum, disengagement, transition, or contradiction over time
• Treat recent changes as higher-weight signals

═══════════════════════════════════════════════════════════════
STOPPING CONDITIONS
═══════════════════════════════════════════════════════════════

Stop when:
• Additional queries are unlikely to materially reduce uncertainty, OR
• The brief's confidence threshold has been met

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
• plan(list): CALL FIRST. Set initial exploration list.
• search(queries): Run queries in parallel. Each needs {query, purpose}.
• reflect(learned, list, done): MANDATORY after search. Update list. Set done=true when finished.
• askUser(question, options): Only if genuinely blocked.

═══════════════════════════════════════════════════════════════
UNCERTAINTY INVARIANT
═══════════════════════════════════════════════════════════════

If available evidence does not uniquely support one conclusion,
the agent must preserve uncertainty rather than resolve it.
Uncertainty is a valid output.
`;


  try {
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

            if (toolName === 'search') {
              const queries = input?.queries || [];
              onProgress?.({
                type: 'search_started',
                count: queries.length,
                queries: queries.map((q: any) => ({ query: q.query, purpose: q.purpose }))
              });
            } else if (toolName === 'reflect') {
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

    const result = await agent.generate({
      prompt: `${contextPrompt}Execute the research brief above.

START by calling plan() with your initial exploration list.

Then run cycles of: search() → reflect()

CRITICAL: Use FULL natural language questions in search.
✅ Good: "What are the most popular finance podcasts in 2024?"
❌ Bad: "finance podcasts 2024"

Update the list each reflect - remove completed items, add new discoveries.
Set done=true when you have enough to answer the objective.`
    });

    // Structured output from AI SDK 6 - typed by ResearchOutputSchema
    const output = result.output;

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
