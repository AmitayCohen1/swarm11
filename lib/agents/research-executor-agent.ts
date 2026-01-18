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
  const MAX_STEPS = 30;
  let completionPayload: any = null;
  let stepCounter = 0;

  const updateBrainTool = tool({
    description: 'Save key findings to the knowledge vault. Use this to record important discoveries.',
    inputSchema: z.object({
      finding: z.string().describe('What you found (be specific: names, numbers, facts)'),
      reasoning: z.string().describe('Why this matters and what you plan to do next')
    }),
    execute: async ({ finding, reasoning }) => {
      // Show in chat that we saved something important
      onProgress?.({
        type: 'agent_thinking',
        thinking: `💾 Saved: ${finding}`
      });

      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';

      // Initialize if empty
      if (!currentBrain.trim()) {
        currentBrain = `# ${researchObjective}\n\n`;
      }

      // Add new entry with timestamp - clear formatting for Knowledge Vault
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const entry = `---\n**[${timestamp}] 💾 FINDING**\n\n${finding}\n\n**Why this matters:** ${reasoning}\n\n`;

      const updatedBrain = currentBrain + entry;

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: updatedBrain });

      return { success: true };
    }
  });

  const askUserTool = tool({
    description: 'Ask the user a question when you realize you don\'t understand what success looks like.',
    inputSchema: z.object({
      question: z.string().describe('Your question to the user')
    }),
    execute: async ({ question }) => {
      onProgress?.({
        type: 'agent_thinking',
        thinking: `❓ ${question}`
      });

      return {
        acknowledged: true,
        note: 'Question sent. User will reply and you can continue.'
      };
    }
  });

  const reflectionTool = tool({
    description: 'REQUIRED after EVERY search() - Evaluate and decide next move.',
    inputSchema: z.object({
      evaluation: z.string().describe('What did the search reveal? Was it useful?'),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete', 'ask_user']),
      reasoning: z.string().describe('Why take this next move? What will you search for next?')
    }),
    execute: async ({ evaluation, nextMove, reasoning }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show in chat - concise version
      onProgress?.({
        type: 'agent_thinking',
        thinking: `💭 ${evaluation} → ${nextMove}: ${reasoning}`
      });

      // Save to Knowledge Vault - detailed version
      const reflection = `---\n**[${timestamp}] 💭 REFLECTION**\n\n**Evaluation:** ${evaluation}\n\n**Next Move:** ${nextMove}\n\n**Reasoning:** ${reasoning}\n\n`;

      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const updatedBrain = (session?.brain || '') + reflection;

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
    saveToBrain: updateBrainTool,
    complete: completionTool
  };

  const instructions = `
  Your job: Research "${researchObjective}" and produce results the user can ACT on.
  
  You are a research agent. Your goal is not to sound impressive — your goal is to be useful.
  
  Before you search:
  1. Decide what kind of research this is:
     - exploratory (understand a topic)
     - comparative (compare options)
     - operational (help the user do something)
     - decision-support (help choose a path)
     - validation (check if something is true)
  
  2. Decide what the user should be able to do after reading your answer.
  3. Decide what would make the result useless.
  
  Use these decisions to guide all your work.
  
  What you can do:
  - search(query): search the web and return results with sources
  - reflect(evaluation, nextMove, reasoning): think about what you learned and decide what to do next (options: continue, pivot, narrow, deep-dive, ask_user, complete)
  - askUser(question): ask the user a question when you realize you don't understand what success looks like
  - saveToBrain(finding, reasoning): save important discoveries
  - complete(reasoning, confidenceLevel, keyFindings, recommendedActions, sourcesUsed, finalAnswerMarkdown): deliver the final result
  
  Core principle:
  Good research = reduces distance to action.
  NOT: impressive names, big numbers, or authoritative sources.

  How to work:
  - Search with natural language questions, not keywords. Use full sentences like "What are the best DevRel candidates in 2026?" instead of "devrel candidates 2026"
  - When choosing between options, prefer what is easy to start with over what is famous or powerful.
  - If two options seem equally relevant, choose the one with less friction.
  - After each search, ask: "Can the user act on this?"
  - If the answer is no, change your approach.
  
  Reflection rules:
  - Say what you learned.
  - Say what is missing.
  - If your results look impressive but hard to act on, that's the wrong direction. Pivot to more accessible options.
  - If you realize you don't understand what would make this useful to the user, use askUser.
  - Decide whether to continue, pivot, narrow, deep-dive, ask_user, or complete.
  - Explain why your next step moves closer to action.
  
  Completion rules:
  - If the research is operational, include:
    - specific people, companies, tools, or resources
    - a clear next step the user could take
  - Do NOT include information that looks impressive but cannot be acted on.
  - The finalAnswerMarkdown should be short, structured, and readable:
    - a short "what to do next" section
    - bullets, not walls of text
    - include a small Sources section (only the most relevant URLs)
  
  Stop when the user has enough to take a concrete next step.
  
  Start by calling search() with a smart first query.
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
      prompt: `${contextPrompt}Research: "${researchObjective}"\n\nStart with search().`
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
