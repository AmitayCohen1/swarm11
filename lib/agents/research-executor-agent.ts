import { ToolLoopAgent, Output, stepCountIs, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { tavilySearch } from '@/lib/tools/tavily-search';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
// import { deductCredits } from '@/lib/credits'; // POC: Disabled for free usage

// Schema for structured research output
const ResearchOutputSchema = z.object({
  confidenceLevel: z.enum(['low', 'medium', 'high']).describe('Confidence in the completeness of findings'),
  keyFindings: z.array(z.string()).describe('Key actionable findings (bullet points)'),
  recommendedActions: z.array(z.string()).describe('Concrete next steps the user should take'),
  finalAnswer: z.string().describe('Complete answer in markdown, concise and actionable')
});

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
  const MAX_STEPS = 100;
  let stepCounter = 0;


  const askUserTool = tool({
    description: 'Ask the user a question with selectable options. Use this to clarify goals, narrow focus, or get decisions.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask'),
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

  const reflectionTool = tool({
    description: 'REQUIRED after EVERY search() - Evaluate what you learned, save key findings, and decide next move.',
    inputSchema: z.object({
      keyFindings: z.string().describe('Concrete discoveries: names, companies, numbers, tools, resources (be specific)'),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete', 'ask_user']),
      userFacingSummary: z.string().describe('A short, clean summary for the user (1-2 sentences). No internal jargon.')
    }),
    execute: async ({ keyFindings, nextMove, userFacingSummary }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Show ONLY the user-facing summary in chat
      if (userFacingSummary) {
        onProgress?.({
          type: 'agent_thinking',
          thinking: userFacingSummary
        });
      }

      // Save detailed findings to brain (internal only, never shown raw to user)
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';

      if (!currentBrain.trim()) {
        currentBrain = `# ${researchObjective}\n\n`;
      }

      // Brain stores findings only - no internal markers
      const reflection = `---\n**[${timestamp}]** ${keyFindings}\n\n`;
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
    askUser: askUserTool
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
  - search(query) — ONE search at a time, then reflect before searching again
  - reflect(keyFindings, nextMove, userFacingSummary) — REQUIRED after EVERY search
  - askUser(question, options) — Ask user with 2-5 clickable options to choose from

  IMPORTANT:
  - Do NOT batch multiple searches. Do one search, reflect on results, then decide next search.
  - When asking the user something, ALWAYS provide clear options they can click on.

  Core principle:
  Good research = reduces distance to action.

  How to work:
  - Search with natural language questions
  - After each search, ask: "Can the user act on this?"
  - Prefer smaller, reachable, testable options over prestigious ones
  - If results look impressive but hard to act on, pivot immediately
  - If you don't understand what would make this useful, ask the user

  Run this loop until you have enough information to give actionable results.
  Start by calling search() with a smart first query.

  When done, your final output will be structured with keyFindings, recommendedActions, and finalAnswer.
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

    // Structured output from AI SDK 6 - typed by ResearchOutputSchema
    const output = result.output;

    return {
      completed: true,
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed,
      output // { confidenceLevel, keyFindings, recommendedActions, finalAnswer }
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
