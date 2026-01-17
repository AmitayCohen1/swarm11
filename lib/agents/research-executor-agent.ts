import { ToolLoopAgent, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { perplexityResearch } from '@/lib/tools/perplexity-research';
import { completionTool } from '@/lib/tools/completion-tool';
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
 * Research Executor Agent - Uses ToolLoopAgent for multi-step autonomous research
 * Updates the shared brain in chat_sessions table
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    userId,
    researchObjective,
    onProgress
  } = config;

  let totalCreditsUsed = 0;
  const MAX_STEPS = 30;

  // Create brain update tool specific to this chat session
  const updateBrainTool = tool({
    description: 'Save research findings to the knowledge base. Call this after each search to accumulate knowledge.',
    inputSchema: z.object({
      findings: z.string().describe('The findings to save'),
      category: z.string().optional().describe('Category for organizing')
    }),
    execute: async ({ findings, category }) => {
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const currentBrain = session?.brain || '';
      const timestamp = new Date().toLocaleString();
      const newEntry = `\n\n## ${category || 'Research Finding'} (${timestamp})\n\n${findings}\n`;
      const updatedBrain = currentBrain + newEntry;

      await db
        .update(chatSessions)
        .set({
          brain: updatedBrain,
          updatedAt: new Date()
        })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit brain update
      onProgress?.({
        type: 'brain_update',
        brain: updatedBrain
      });

      return {
        success: true,
        brainSize: updatedBrain.length,
        brain: updatedBrain
      };
    }
  });

  const tools = {
    search: perplexityResearch,
    saveToBrain: updateBrainTool,
    complete: completionTool
  };

  const instructions = `You are a strategic research agent. Your objective: "${researchObjective}"

FIRST: Understand the deliverable
- What exactly does the user need as the end result?
- If objective is "find companies that need X" → deliverable is a LIST of companies with: name, why they need it, scale, contact approach
- If objective is "research how X works" → deliverable is a comprehensive EXPLANATION with examples
- If objective is "compare X vs Y" → deliverable is a detailed COMPARISON with pros/cons

STRATEGIC APPROACH:
Think about your research strategy to get that deliverable:
- "Okay, so to get [deliverable], I'd probably first search for [broad category]..."
- "Then once I have those, I'll drill down into each one to find [specific details needed]..."
- "I'll know I'm done when I have [specific success criteria]..."

EXECUTION:
1. State what deliverable you're aiming for (1 sentence)
2. Explain your research strategy (1-2 sentences)
3. Call search() to execute the first step
4. React to findings: "Cool! I found X. Now let me dig into the first one..."
5. Call saveToBrain() after each search with findings
6. Drill down systematically through each item
7. Call complete() ONLY when you have the complete deliverable ready

COMPLETION CRITERIA:
- For "find companies": Have 5-10 specific companies with detailed profiles
- For "research topic": Have comprehensive explanation with examples and sources
- For "compare options": Have detailed comparison with clear recommendations
- Don't finish early - make sure you have ACTIONABLE, COMPLETE information

VIBE:
- Strategic: "To get you a list of companies, first I'll search for X, then drill into each..."
- Excited: "Awesome! Found 5 companies. Let me check the first one's details..."
- Methodical: Work through items one by one until complete
- Goal-oriented: Always know what the end deliverable looks like

IMPORTANT: You MUST call tools - explaining your plan is good, but you still need to execute searches!

START: State the deliverable you're aiming for, explain your strategy, then call search() with your first query.`;

  try {
    // Create the ToolLoopAgent - it handles the entire loop automatically
    const agent = new ToolLoopAgent({
      model: anthropic('claude-sonnet-4-20250514'),
      instructions,
      tools,
      maxSteps: MAX_STEPS,
      onStepFinish: async ({ text, toolCalls, toolResults, usage }) => {
        // Calculate and deduct credits
        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;
        await deductCredits(userId, stepCredits);

        // Emit agent thinking
        if (text) {
          onProgress?.({
            type: 'agent_thinking',
            thinking: text
          });

          // Save reasoning to brain
          const [session] = await db
            .select({ brain: chatSessions.brain })
            .from(chatSessions)
            .where(eq(chatSessions.id, chatSessionId));

          const existingBrain = session?.brain || '';
          const updatedBrain = existingBrain + `\n\n**Agent Reasoning:** ${text}\n`;

          await db
            .update(chatSessions)
            .set({ brain: updatedBrain, updatedAt: new Date() })
            .where(eq(chatSessions.id, chatSessionId));

          onProgress?.({
            type: 'brain_update',
            brain: updatedBrain
          });
        }

        // Process tool calls for progress updates
        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            const args = toolCall.args;

            console.log(`Tool called: ${toolName}`, args);

            // Emit search query
            if (toolName === 'search') {
              onProgress?.({
                type: 'research_query',
                query: args?.query || 'Searching...'
              });
            }
          }
        }

        // Process tool results for search results display
        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            const toolResult = result.result;

            // Emit search results
            if (toolName === 'search' && toolResult?.answer) {
              let resultMessage = `📄 **Search Result:**\n\n---\n\n${toolResult.answer}`;

              if (toolResult.sources && toolResult.sources.length > 0) {
                resultMessage += `\n\n---\n\n**📚 Sources:**\n`;
                toolResult.sources.forEach((source: any, idx: number) => {
                  if (typeof source === 'string') {
                    resultMessage += `${idx + 1}. ${source}\n`;
                  } else if (source.url) {
                    resultMessage += `${idx + 1}. [${source.title || source.url}](${source.url})\n`;
                  }
                });
              }

              onProgress?.({
                type: 'search_result',
                query: result.args?.query,
                answer: toolResult.answer,
                sources: toolResult.sources || []
              });
            }
          }
        }
      }
    });

    // Execute the agent
    const result = await agent.generate({
      prompt: `Research this: "${researchObjective}"\n\nStart by calling the search tool with your first query.`
    });

    return {
      completed: result.finishReason === 'tool-calls' || result.finishReason === 'stop',
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
