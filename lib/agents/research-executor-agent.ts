import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { perplexityResearch } from '@/lib/tools/perplexity-research';
import { completionTool } from '@/lib/tools/completion-tool';
import { createResearchPlan, summarizeFindings } from '@/lib/tools/planning-tool';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { deductCredits } from '@/lib/credits';

interface ResearchExecutorConfig {
  chatSessionId: string;
  userId: string;
  researchObjective: string;
  onProgress?: (update: any) => void;
}

/**
 * Research Executor Agent - Spawned by orchestrator to conduct autonomous research
 * Updates the shared brain in chat_sessions table
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    userId,
    researchObjective,
    onProgress
  } = config;

  let currentIteration = 0;
  let shouldStop = false;
  let totalCreditsUsed = 0;
  const MAX_SAFETY_ITERATIONS = 50; // Safety limit to prevent runaway

  // Create brain update tool specific to this chat session
  const updateBrainTool = {
    description: 'Add research findings to the shared conversation brain. Use this after each research query to accumulate knowledge.',
    inputSchema: z.object({
      findings: z.string().describe('The new findings to add to the brain'),
      category: z.string().optional().describe('Category or topic for organizing findings')
    }),
    execute: async ({ findings, category }: { findings: string; category?: string }) => {
      // Get current brain
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const currentBrain = session?.brain || '';

      // Append new findings
      const timestamp = new Date().toLocaleString();
      const newEntry = `\n\n## ${category || 'Research Finding'} (${timestamp})\n\n${findings}\n`;
      const updatedBrain = currentBrain + newEntry;

      // Save to chat session
      await db
        .update(chatSessions)
        .set({
          brain: updatedBrain,
          updatedAt: new Date()
        })
        .where(eq(chatSessions.id, chatSessionId));

      return {
        success: true,
        brainSize: updatedBrain.length,
        message: 'Brain updated with new findings',
        brain: updatedBrain
      };
    }
  };

  // Clarification tool for asking user questions
  const askClarificationTool = {
    description: 'Ask the user a clarifying question when you need more information or direction to continue research effectively.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the user'),
      context: z.string().describe('Why you need this clarification and what you have found so far')
    }),
    execute: async ({ question, context }: { question: string; context: string }) => {
      return {
        needsClarification: true,
        question,
        context
      };
    }
  };

  const tools = {
    createResearchPlan,
    perplexityResearch,
    updateBrain: updateBrainTool,
    summarizeFindings,
    askClarification: askClarificationTool,
    complete: completionTool
  };

  const systemPrompt = `You are a research executor agent. You MUST use tools to do research.

YOUR RESEARCH OBJECTIVE:
"${researchObjective}"

CRITICAL: You MUST call tools on every turn. Thinking alone doesn't count - CALL THE TOOLS!

THE SIMPLE LOOP:

**ITERATION 1:**
→ CALL createResearchPlan tool with strategy + 3-5 questions

**ITERATIONS 2+:**
→ CALL perplexityResearch to search
→ Think: "Cool! Found X. This means Y. Now let's search Z..."
→ CALL updateBrain to save findings
→ REPEAT

**STOP:**
→ CALL complete when you have comprehensive answers

COMMUNICATION STYLE:
- Be excited: "Awesome!", "Great!", "Interesting!"
- Connect findings: "I found X, so now let's search for Y..."
- Think out loud between tool calls

YOU MUST ALWAYS CALL A TOOL - never just think without calling tools!

Current iteration: ${currentIteration + 1}`;

  // Update chat session status
  await db
    .update(chatSessions)
    .set({
      status: 'researching',
      currentResearch: {
        objective: researchObjective,
        startedAt: new Date().toISOString(),
        progress: 0
      },
      updatedAt: new Date()
    })
    .where(eq(chatSessions.id, chatSessionId));

  let conversationContext = `START NEW RESEARCH SESSION

Your objective: "${researchObjective}"

This is a FRESH research session. You have no prior knowledge or context.

MANDATORY FIRST ACTION: Call the createResearchPlan tool NOW with:
- strategy: Your research approach
- questions: 3-5 specific research questions
- reasoning: Why this plan makes sense

DO NOT just think about it - ACTUALLY CALL THE TOOL!`;

  let hasCreatedPlan = false;
  let fullConversationHistory: string[] = [];

  try {
    // Research loop - agent decides when to stop
    while (!shouldStop && currentIteration < MAX_SAFETY_ITERATIONS) {
      currentIteration++;

      // Fetch current brain content so agent can see what it's already learned
      const [currentSession] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const currentBrain = currentSession?.brain || '';

      // Update context for subsequent iterations
      if (currentIteration > 1) {
        conversationContext = `ITERATION ${currentIteration} - Continue your research

Objective: "${researchObjective}"

**WHAT YOU'VE DONE SO FAR (your own work):**
${fullConversationHistory.slice(-15).join('\n')}

---

${currentBrain ? `**YOUR KNOWLEDGE BASE:**
${currentBrain}

---

` : ''}**NEXT STEP:** Look at what you just found above. Think out loud about what it means, then decide what to search for next to build on these findings.`;
      }

      // Emit progress
      onProgress?.({
        type: 'research_iteration',
        iteration: currentIteration
      });

      // Generate and execute tools manually (AI SDK v6 generateText is single-step)
      let stepCount = 0;
      let currentPrompt = conversationContext;
      let finalText = '';
      let hitStopCondition = false;
      let stopToolCall: any = null;

      // Multi-step tool loop (up to 5 steps per iteration)
      while (stepCount < 5 && !hitStopCondition) {
        const result = await generateText({
          model: anthropic('claude-sonnet-4-20250514'),
          system: systemPrompt,
          prompt: currentPrompt,
          tools,
          temperature: 0.3
        });

        console.log('GenerateText result:', {
          hasToolCalls: !!result.toolCalls,
          toolCallCount: result.toolCalls?.length || 0,
          toolCalls: result.toolCalls?.map(tc => ({
            name: tc.toolName,
            fullToolCall: JSON.stringify(tc).substring(0, 200),
            hasArgs: !!(tc as any).args,
            hasInput: !!(tc as any).input,
            argsKeys: Object.keys((tc as any).args || {}),
            inputKeys: Object.keys((tc as any).input || {})
          }))
        });

        // Calculate credits
        const stepCredits = Math.ceil((result.usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;
        await deductCredits(userId, stepCredits);

        // Emit thinking and append to brain for context
        if (result.text) {
          finalText = result.text;

          // Add to conversation history
          fullConversationHistory.push(`[YOUR PREVIOUS THOUGHT]: ${result.text}`);

          onProgress?.({
            type: 'agent_thinking',
            iteration: currentIteration,
            thinking: result.text,
            creditsUsed: stepCredits
          });

          // Append agent reasoning to brain
          const [session] = await db
            .select({ brain: chatSessions.brain })
            .from(chatSessions)
            .where(eq(chatSessions.id, chatSessionId));

          const existingBrain = session?.brain || '';
          const updatedBrain = existingBrain + `\n\n**Agent Reasoning (Iteration ${currentIteration}):** ${result.text}\n`;

          await db
            .update(chatSessions)
            .set({ brain: updatedBrain, updatedAt: new Date() })
            .where(eq(chatSessions.id, chatSessionId));

          // Emit brain update
          onProgress?.({
            type: 'brain_update',
            brain: updatedBrain
          });
        }

        // Check if there are tool calls
        if (!result.toolCalls || result.toolCalls.length === 0) {
          // No more tools to execute
          console.log('No tool calls, breaking loop');
          break;
        }

        // Execute tools and collect results
        const toolResults: Array<{ toolName: string; result: any }> = [];

        for (const toolCall of result.toolCalls) {
          const args = (toolCall as any).args || (toolCall as any).input;
          const toolName = toolCall.toolName;

          console.log(`Executing tool: ${toolName}`, { args });

          // Add tool call to conversation history
          if (toolName === 'perplexityResearch') {
            fullConversationHistory.push(`[YOU searched for]: "${args?.query}"`);
          } else if (toolName === 'createResearchPlan') {
            fullConversationHistory.push(`[YOU created research plan with ${args?.questions?.length} questions]`);
          } else if (toolName === 'updateBrain') {
            fullConversationHistory.push(`[YOU saved to brain]: ${args?.category}`);
          }

          // Emit progress BEFORE execution
          if (toolName === 'perplexityResearch') {
            onProgress?.({
              type: 'research_query',
              iteration: currentIteration,
              query: args?.query || 'Searching...',
              toolName: 'perplexityResearch'
            });
          } else if (toolName === 'createResearchPlan') {
            hasCreatedPlan = true;
            onProgress?.({
              type: 'plan_created',
              iteration: currentIteration,
              plan: {
                strategy: args?.strategy,
                questions: args?.questions,
                reasoning: args?.reasoning
              }
            });
          } else if (toolName === 'updateBrain') {
            onProgress?.({
              type: 'brain_updated',
              iteration: currentIteration,
              category: args?.category || 'Research Finding',
              findings: args?.findings?.substring(0, 200) + '...'
            });
          } else if (toolName === 'summarizeFindings') {
            onProgress?.({
              type: 'summary_created',
              iteration: currentIteration,
              keyInsights: args?.keyInsights
            });
          }

          // Execute tool
          try {
            const tool = tools[toolName as keyof typeof tools];
            if (tool && typeof tool.execute === 'function') {
              if (!args) {
                console.error(`No args for tool ${toolName}, full toolCall:`, JSON.stringify(toolCall));
                toolResults.push({ toolName, result: { error: 'No arguments provided' } });
                fullConversationHistory.push(`[Tool Result]: ERROR - No arguments`);
                continue;
              }
              const toolResult = await tool.execute(args);
              console.log(`Tool ${toolName} executed successfully:`, toolResult);
              toolResults.push({ toolName, result: toolResult });

              // Add result to conversation history
              if (toolName === 'perplexityResearch' && toolResult.answer) {
                fullConversationHistory.push(`[YOU just got this search result]:\n${toolResult.answer}\n(${toolResult.sources?.length || 0} sources found)`);
              } else if (toolName === 'updateBrain') {
                fullConversationHistory.push(`[YOU saved findings to brain]`);
              }

              // Emit results AFTER execution
              if (toolName === 'perplexityResearch' && toolResult.answer) {
                onProgress?.({
                  type: 'search_result',
                  iteration: currentIteration,
                  query: args?.query || 'Search',
                  answer: toolResult.answer,
                  sources: toolResult.sources || []
                });
              } else if (toolName === 'updateBrain' && toolResult.brain) {
                // Emit brain update when brain is updated
                onProgress?.({
                  type: 'brain_update',
                  brain: toolResult.brain
                });
              }
            } else {
              console.error(`Tool ${toolName} not found or no execute function`);
              toolResults.push({ toolName, result: { error: 'Tool not found' } });
            }
          } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            toolResults.push({ toolName, result: { error: String(error) } });
          }

          // Check for stop conditions
          if (toolName === 'complete' || toolName === 'askClarification') {
            // These tools signal we should stop the loop
            hitStopCondition = true;
            stopToolCall = { toolName, args, result: toolResults[toolResults.length - 1]?.result };
            break;
          }
        }

        // If we hit a stop condition, break
        if (hitStopCondition) break;

        // Prepare next prompt - force tool usage
        currentPrompt = `Your tools executed successfully.

Now you MUST:
1. Think out loud about what you learned
2. CALL perplexityResearch with your next query

DO NOT just say you will search - ACTUALLY CALL THE TOOL NOW!`;

        stepCount++;
      }

      // Check if agent asked for clarification
      if (stopToolCall && stopToolCall.toolName === 'askClarification') {
        shouldStop = true;
        const args = stopToolCall.args;

        // Update chat session to waiting state
        await db
          .update(chatSessions)
          .set({
            status: 'waiting_for_user',
            currentResearch: {
              objective: researchObjective,
              pendingQuestion: {
                question: args?.question,
                context: args?.context
              },
              iteration: currentIteration
            },
            updatedAt: new Date()
          })
          .where(eq(chatSessions.id, chatSessionId));

        onProgress?.({
          type: 'needs_clarification',
          question: args?.question,
          context: args?.context,
          totalIterations: currentIteration,
          creditsUsed: totalCreditsUsed
        });

        return {
          success: true,
          needsClarification: true,
          question: args?.question,
          context: args?.context,
          iterations: currentIteration,
          creditsUsed: totalCreditsUsed,
          stopReason: 'needs_clarification'
        };
      }

      // Check if agent signaled completion
      if (stopToolCall && stopToolCall.toolName === 'complete') {
        shouldStop = true;

        // Get final brain state
        const [finalSession] = await db
          .select({ brain: chatSessions.brain })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        // Update chat session
        await db
          .update(chatSessions)
          .set({
            status: 'active',
            currentResearch: null,
            creditsUsed: totalCreditsUsed,
            updatedAt: new Date()
          })
          .where(eq(chatSessions.id, chatSessionId));

        onProgress?.({
          type: 'research_complete',
          reasoning: stopToolCall.args?.reasoning,
          totalIterations: currentIteration,
          creditsUsed: totalCreditsUsed,
          brainContent: finalSession?.brain || ''
        });

        return {
          success: true,
          iterations: currentIteration,
          creditsUsed: totalCreditsUsed,
          brain: finalSession?.brain || '',
          stopReason: 'goal_achieved'
        };
      }

      // Update conversation context for next iteration
      conversationContext = `Previous iteration completed. ${finalText.substring(0, 200) || 'Continue researching.'}

What's your next step? Continue researching systematically.`;

      // Update progress in database
      await db
        .update(chatSessions)
        .set({
          currentResearch: {
            objective: researchObjective,
            startedAt: new Date().toISOString(),
            iteration: currentIteration
          },
          updatedAt: new Date()
        })
        .where(eq(chatSessions.id, chatSessionId));
    }

    // Safety limit reached (should rarely happen - agent should call complete)
    const [finalSession] = await db
      .select({ brain: chatSessions.brain })
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    await db
      .update(chatSessions)
      .set({
        status: 'active',
        currentResearch: null,
        creditsUsed: totalCreditsUsed,
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, chatSessionId));

    onProgress?.({
      type: 'research_complete',
      totalIterations: currentIteration,
      creditsUsed: totalCreditsUsed,
      stopReason: 'safety_limit',
      brainContent: finalSession?.brain || ''
    });

    return {
      success: true,
      iterations: currentIteration,
      creditsUsed: totalCreditsUsed,
      brain: finalSession?.brain || '',
      stopReason: 'safety_limit'
    };

  } catch (error: any) {
    // Update chat session on error
    await db
      .update(chatSessions)
      .set({
        status: 'active',
        currentResearch: null,
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, chatSessionId));

    onProgress?.({
      type: 'error',
      message: error.message
    });

    throw error;
  }
}
