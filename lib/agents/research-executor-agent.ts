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
  const MAX_STEPS = 500; // Allow truly exhaustive research - go as deep as needed
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
      reasoning: z.string().describe('What you found, what you want to search next, and why. Keep it concise - 1-2 sentences max.')
    }),
    execute: async ({ keyFindings, evaluation, nextMove, reasoning }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show in chat - concise version
      onProgress?.({
        type: 'agent_thinking',
        thinking: `${keyFindings}\n\nNext: ${nextMove} - ${reasoning}`
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

  You are a research agent. Your goal is not to sound impressive — your goal is to be useful.

  DEPTH REQUIREMENTS:
  - You have virtually unlimited steps. Use as many as you need. Deep research is valuable research.
  - Don't rush to complete(). Keep searching as long as you're finding valuable information.
  - There's no such thing as "too thorough" - go as deep as the topic deserves
  - Minimum 10-15 searches before even considering completion, but don't hesitate to do 20, 30, 50+ if valuable
  - Each search should open new questions or verify previous findings
  - Cross-reference information between multiple sources
  - Go deeper: if you find something promising, drill down with follow-up searches
  - Explore tangents that might lead to better options
  - Follow rabbit holes - they often lead to the best insights

  Before you search:
  1. Decide what kind of research this is:
     - exploratory (understand a topic deeply)
     - comparative (compare multiple options thoroughly)
     - operational (find actionable resources with verification)
     - decision-support (gather evidence from multiple angles)
     - validation (cross-check claims across sources)

  2. Decide what the user should be able to do after reading your answer.
  3. Decide what would make the result useless.

  IMPORTANT:
  - Choose a starting point that minimizes friction, commitment, and adoption cost.
  - Do NOT start with the biggest or most famous entities unless explicitly instructed.
  - Don't accept surface-level information - dig deeper with follow-up searches
  - When in doubt, do another search rather than completing

  What you can do:
  - search(query)
  - reflect(keyFindings, evaluation, nextMove, reasoning) — REQUIRED after EVERY search
    → reasoning should be SHORT: what you found, what you want to search next, and why (1-2 sentences max)
  - askUser(question)
  - complete(reasoning, confidenceLevel, keyFindings, recommendedActions, sourcesUsed, finalAnswerMarkdown)

  Core principle:
  Good research = reduces distance to action + verified through multiple sources + thoroughly explored.

  How to work:
  - Search with natural language questions
  - After each search, ask: "Can the user act on this? Is this verified? What else should I check?"
  - Prefer smaller, reachable, testable options over prestigious ones
  - If results look impressive but hard to act on, pivot immediately
  - If you find something promising, search again to verify or find alternatives
  - Cross-reference: if search 1 mentions X, search 2 should verify or explore X deeper
  - Follow interesting threads even if they seem tangential
  - If you don't understand what would make this useful, ask the user

  Reflection format (be concise):
  - keyFindings: Specific names, numbers, resources discovered
  - evaluation: What was useful, what's missing (1-2 sentences)
  - nextMove: continue/pivot/narrow/deep-dive/complete/ask_user
  - reasoning: What you found, what you want to search next, and why (1-2 sentences max)

  Research pattern examples:
  - Search 1: Broad overview
  - Search 2-4: Specific options discovered
  - Search 5-8: Verify each option, find alternatives
  - Search 9-12: Dig deeper into promising options
  - Search 13+: Cross-reference, verify edge cases, explore related topics
  - Keep going until you've truly exhausted useful angles

  Completion rules (only after substantial research):
  - You've done 10-15+ searches exploring different angles
  - You've verified findings across multiple sources
  - You've explored alternatives and compared options
  - You have actionable results with clear next steps
  - You genuinely can't think of another search that would improve the answer
  - Do NOT include information that cannot be acted on
  - Final answer should be short, structured, and readable

  When to complete():
  - You've exhausted useful search angles (not after a few searches!)
  - You have deeply verified, actionable results
  - You've cross-referenced key information multiple times
  - You've explored tangents and alternative approaches
  - The research is truly comprehensive, not just "good enough"

  Start by calling search() with a smart first query. Expect to do MANY more searches after that.
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
