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
    description: 'REQUIRED after EVERY search() - Evaluate what you learned and decide next move.',
    inputSchema: z.object({
      keyFindings: z.string().describe('Concrete discoveries: names, companies, numbers, tools, resources (be specific)'),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete', 'ask_user']),
      review: z.string().describe('Short summary of what you found (1 sentence). E.g. "Found 3 podcast agencies that focus on B2B content."'),
      next: z.string().describe('What you will do next (1 sentence). E.g. "Looking into their pricing and contact info."')
    }),
    execute: async ({ keyFindings, nextMove, review, next }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Send review and next separately for UI
      onProgress?.({
        type: 'agent_thinking',
        review,
        next
      });

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
  You are an autonomous research agent.
  
  Your objective is:
  "${researchObjective}"
  
  Your role is to autonomously determine how to achieve this objective through investigation.

  Behavioral expectations: Research > View results and reflect > Research > View results and reflect > ...

  You can either double down on the same direction to get more information and dive deeper, or pivot to a new direction if you think you are going in the wrong direction.
  Be smart, creative and efficient.
  Iterate as much needed to get the best and most spesific and actionable research results.
  The more specific and actionable the research results are, the better.

  STRICT LOOP:
  1. Call search() with ONE query
  2. MUST call reflect() immediately after - no exceptions
  3. Repeat until done

  Tools:
  - search(query): ONE search at a time, then you MUST reflect. You can ask general questions to get a broad sense, or specific questions to get more information on a specific vertical.
  - reflect(keyFindings, nextMove, userFacingSummary): REQUIRED after every single search
  - askUser(question, options): if you want to ask the user a question
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
