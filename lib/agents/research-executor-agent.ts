import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { tavilySearch } from '@/lib/tools/tavily-search';
import { completionTool } from '@/lib/tools/completion-tool';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
// import { deductCredits } from '@/lib/credits'; // POC: Disabled for free usage

interface ResearchExecutorConfig {
  chatSessionId: string;
  userId: string;
  researchObjective: string;
  conversationHistory?: any[];
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

/**
 * Research Executor Agent - Uses ToolLoopAgent for multi-step autonomous research
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    userId,
    researchObjective,
    conversationHistory = [],
    onProgress,
    abortSignal
  } = config;

  let totalCreditsUsed = 0;
  const MAX_STEPS = 100; // Allow truly exhaustive research - go as deep as needed
  let completionPayload: any = null;
  let stepCounter = 0;


  const askUserTool = tool({
    description: 'Ask the user a question when you realize you don\'t understand what success looks like.',
    inputSchema: z.object({
      question: z.string().describe('Your question to the user')
    }),
    execute: async ({ question }) => {
      onProgress?.({
        type: 'agent_thinking',
        thinking: question
      });

      return {
        acknowledged: true,
        note: 'Question sent. User will reply and you can continue.'
      };
    }
  });

  const reflectionTool = tool({
    description: 'REQUIRED after EVERY search() - Evaluate what you learned, save key findings, and decide next move.',
    inputSchema: z.object({
      keyFindings: z.string().describe('Concrete discoveries: names, companies, numbers, tools, resources (be specific)'),
      evaluation: z.string().describe('What did the search reveal? Was it useful? What\'s missing?'),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete', 'ask_user']),
      reasoning: z.string().describe('Desribe what we found, and what we should do next, keep it short and concise: "We found that... and we should do next... because..."')
    }),
    execute: async ({ keyFindings, evaluation, nextMove, reasoning }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show in chat - structured version for UI
      onProgress?.({
        type: 'agent_thinking',
        evaluation,
        nextMove,
        reasoning,
        thinking: `${evaluation}\n\nNext: ${nextMove} - ${reasoning}` // Fallback for simple rendering
      });

      // Save to Knowledge Vault - detailed version with findings highlighted
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';

      // Initialize if empty
      if (!currentBrain.trim()) {
        currentBrain = `# ${researchObjective}\n\n`;
      }

      const reflection = `---\n**[${timestamp}] RESEARCH UPDATE**\n\n${keyFindings}\n\n**Evaluation:** ${evaluation}\n\n**Next Move:** ${nextMove}\n\n**Reasoning:** ${reasoning}\n\n`;

      const updatedBrain = currentBrain + reflection;

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: updatedBrain });

      return { acknowledged: true, direction: nextMove };
    }
  });

  const tools = {
    search: tavilySearch,
    reflect: reflectionTool,
    askUser: askUserTool,
    complete: completionTool
  };
  const instructions = `
  Your job: Research "${researchObjective}" and produce results the user can ACT on.
  Be smart and strategic, try to understand deeply what's the user goal, and ask smart questions to find the answer.
  Your job is to conduct research and strateiggly look for the information the user is looking for.

  The cycle you should follow is: 
  1. Search for the information
  2. Reflect on the results
  3. Dive deeper or change direction
  
  Before you search:
  1. Decide what kind of research this is:
     - exploratory
     - comparative
     - operational
     - decision-support
     - validation
  
  2. Decide what the user should be able to do after reading your answer.
  3. Decide what would make the result useless.
  
  IMPORTANT:
  - Choose a starting point that minimizes friction, commitment, and adoption cost.
  - Do NOT start with the biggest or most famous entities unless explicitly instructed.
  
  What you can do:
  - search(query)
  - reflect(keyFindings, evaluation, nextMove, reasoning) — REQUIRED after EVERY search
  - askUser(question)
  - complete(reasoning, confidenceLevel, keyFindings, recommendedActions, sourcesUsed, finalAnswerMarkdown)
  
  Core principle:
  Good research = reduces distance to action.
  
  How to work:
  - Search with natural language questions
  - After each search, ask: "Can the user act on this?"
  - Prefer smaller, reachable, testable options over prestigious ones
  - If results look impressive but hard to act on, pivot immediately
  - If you don’t understand what would make this useful, ask the user
  
  You can run this loop as many times as needed, until you reach the goal, or you can't find any more information, or need to ask the user for clarification.

  Start by calling search() with a smart first query.

  When you reach the goal, or you can't find any more information, or need to ask the user for clarification, call the complete() tool.
  `;
  

  try {
    const agent = new ToolLoopAgent({
      model: anthropic('claude-sonnet-4-20250514'),
      instructions,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      onStepFinish: async (step: any) => {
        const { text, toolCalls, toolResults, usage } = step || {};
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

        // POC: Credit deduction disabled - free to use
        // TODO: Re-enable before production launch
        // await deductCredits(userId, stepCredits);

        // Emit lightweight counters for the UI (useful for user trust + debugging)
        onProgress?.({
          type: 'research_iteration',
          iteration: stepCounter,
          creditsUsed: totalCreditsUsed,
          tokensUsed: usage?.totalTokens || 0
        });

        if (text) {
          onProgress?.({ type: 'agent_thinking', thinking: text });
        }

        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            const input = (toolCall as any).input;

            if (toolName === 'search') {
              onProgress?.({
                type: 'research_query',
                query: input?.query || 'Searching...'
              });
            }
          }
        }

        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            const toolResult = (result as any).output;

            if (toolName === 'search') {
              // Map Tavily results to sources format
              const sources = (toolResult?.results || []).map((r: any) => ({
                title: r.title,
                url: r.url
              }));

              onProgress?.({
                type: 'search_result',
                query: (result as any).input?.query,
                answer: toolResult?.answer || '',
                sources
              });
            }

            if (toolName === 'complete') {
              completionPayload = toolResult;
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
      prompt: `${contextPrompt}Research: "${researchObjective}"

CRITICAL: Use FULL natural language questions for ALL searches.
✅ Good: "What are the most popular finance podcasts in 2024?"
❌ Bad: "finance podcasts 2024"

Start with search() using a complete, readable question.`
    });

    return {
      completed: result.finishReason === 'tool-calls' || result.finishReason === 'stop',
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed,
      completion: completionPayload
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
