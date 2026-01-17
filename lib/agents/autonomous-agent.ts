import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { perplexityResearch } from '@/lib/tools/perplexity-research';
import { createBrainTool } from '@/lib/tools/brain-tool';
import { completionTool } from '@/lib/tools/completion-tool';
import { z } from 'zod';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { deductCredits, hasEnoughCredits } from '@/lib/credits';

interface AgentConfig {
  sessionId: string;
  userId: string;
  objective: string;
  maxIterations: number;
  onProgress?: (update: any) => void;
}

export async function createAndRunAutonomousAgent(config: AgentConfig) {
  const { sessionId, userId, objective, maxIterations, onProgress } = config;

  // Define askClarification tool
  const askClarification = {
    description: 'Ask the user a clarifying question if the objective is ambiguous or you need to make a decision. Use this VERY sparingly - only when truly necessary for the research direction.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the user'),
      context: z.string().describe('Why you need this clarification and how it affects the research')
    }),
    execute: async ({ question, context }: { question: string; context: string }) => {
      // Return the question for user to answer
      return {
        needsUserInput: true,
        question,
        context
      };
    }
  };

  const tools = {
    perplexityResearch,
    updateBrain: createBrainTool(sessionId),
    complete: completionTool,
    askClarification
  };

  const systemPrompt = `You are an autonomous research agent. Your objective is:

"${objective}"

Your approach:
1. Break down the objective into specific, strategic research questions
2. Use perplexityResearch to gather current information with citations
3. After EACH research query, use updateBrain to accumulate findings in the knowledge document
4. You can ask the user for clarification if the objective is ambiguous (use sparingly)
5. When you have sufficient comprehensive information, call complete to finish

The "brain" is a markdown document that accumulates all your findings. Think of it as your research notebook - update it frequently to track progress and organize information.

Research Strategy:
- Be strategic: plan queries to cover different aspects of the objective
- Each query should build on previous findings
- Look for gaps in your knowledge and fill them systematically
- Organize findings by theme/topic in the brain
- When you have enough high-quality information to fully address the objective, call complete

Guidelines:
- Keep research focused and relevant to the objective
- Update brain after every research query
- Quality over quantity - better to do fewer high-value queries
- Signal completion when the objective is thoroughly addressed, don't waste iterations

IMPORTANT: Call the 'complete' tool ONLY when you actively decide the research objective is fully achieved. Do NOT call it when running out of credits or iterations - those are handled automatically.`;

  let currentIteration = 0;
  let totalCreditsUsed = 0;
  let shouldStop = false;
  let stopReason: string | null = null;
  let completionData: any = null;

  // Start with initial prompt
  let conversationMessages: any[] = [
    {
      role: 'user',
      content: `Begin researching the objective: ${objective}`
    }
  ];

  try {
    // Multi-step autonomous loop
    while (currentIteration < maxIterations && !shouldStop) {
      currentIteration++;

      // Check credits before iteration
      const estimatedCost = 100;
      const canContinue = await hasEnoughCredits(userId, estimatedCost);

      if (!canContinue) {
        stopReason = 'insufficient_credits';
        break;
      }

      // Check if session was stopped by user
      const [session] = await db
        .select({ status: autonomousSessions.status })
        .from(autonomousSessions)
        .where(eq(autonomousSessions.id, sessionId));

      if (session?.status === 'stopped') {
        stopReason = 'user_stopped';
        break;
      }

      // Run agent step
      const result = await generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        system: systemPrompt,
        messages: conversationMessages,
        tools,
        temperature: 0.3
      });

      // Calculate credits for this step
      const creditsUsed = Math.ceil((result.usage.totalTokens || 0) / 1000);
      totalCreditsUsed += creditsUsed;

      // Deduct credits
      await deductCredits(userId, creditsUsed);

      // Update session in database
      await db
        .update(autonomousSessions)
        .set({
          iterationCount: currentIteration,
          creditsUsed: sql`${autonomousSessions.creditsUsed} + ${creditsUsed}`,
          lastReasoning: {
            text: result.text?.substring(0, 500),
            tokens: result.usage.totalTokens
          },
          updatedAt: new Date()
        })
        .where(eq(autonomousSessions.id, sessionId));

      // Extract tool calls for progress update
      const toolCalls = result.toolCalls?.map((tc: any) => ({
        tool: tc.toolName,
        input: tc.args || tc.input
      })) || [];

      // Emit progress event
      onProgress?.({
        type: 'step_complete',
        iteration: currentIteration,
        text: result.text?.substring(0, 200),
        toolCalls,
        creditsUsed,
        tokensUsed: result.usage.totalTokens
      });

      // Check if agent called complete tool
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls as any[]) {
          if (toolCall.toolName === 'complete') {
            shouldStop = true;
            stopReason = 'goal_achieved';
            completionData = toolCall.args || toolCall.input;
            break;
          }
        }
      }

      // Add assistant response to conversation
      conversationMessages.push({
        role: 'assistant',
        content: result.text || '',
        toolCalls: result.toolCalls
      });

      // Add tool results to conversation
      if (result.toolResults) {
        conversationMessages.push({
          role: 'tool',
          content: result.toolResults.map((tr: any) => ({
            type: 'tool-result',
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            result: tr.result || tr.output
          }))
        });
      }

      // If no more tool calls and no completion, continue
      if (!result.toolCalls || result.toolCalls.length === 0) {
        // Agent didn't make any tool calls, prompt it to continue
        conversationMessages.push({
          role: 'user',
          content: 'Continue your research. What is the next step?'
        });
      }
    }

    // Determine final stop reason
    if (!stopReason) {
      stopReason = currentIteration >= maxIterations ? 'max_queries' : 'unknown';
    }

    // Get final brain state
    const [finalSession] = await db
      .select({ brain: autonomousSessions.brain, creditsUsed: autonomousSessions.creditsUsed })
      .from(autonomousSessions)
      .where(eq(autonomousSessions.id, sessionId));

    // Generate final report
    const finalReport = await generateFinalReport(
      objective,
      finalSession?.brain || '',
      completionData
    );

    // Update session as completed
    await db
      .update(autonomousSessions)
      .set({
        status: 'completed',
        finalReport,
        stopReason,
        completedAt: new Date()
      })
      .where(eq(autonomousSessions.id, sessionId));

    return {
      success: true,
      finalReport,
      stopReason,
      totalSteps: currentIteration,
      creditsUsed: totalCreditsUsed
    };

  } catch (error: any) {
    // Mark session as failed
    await db
      .update(autonomousSessions)
      .set({
        status: 'failed',
        stopReason: 'error'
      })
      .where(eq(autonomousSessions.id, sessionId));

    throw error;
  }
}

async function generateFinalReport(
  objective: string,
  brain: string,
  completionData: any
): Promise<string> {
  const { generateText } = await import('ai');
  const { anthropic } = await import('@ai-sdk/anthropic');

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    prompt: `Create a comprehensive final research report.

OBJECTIVE:
${objective}

ACCUMULATED KNOWLEDGE (BRAIN):
${brain}

${completionData ? `
COMPLETION SUMMARY:
- Confidence: ${completionData.confidenceLevel}
- Reasoning: ${completionData.reasoning}
- Key Findings: ${completionData.keyFindings?.join(', ') || 'N/A'}
` : ''}

Generate a well-structured markdown report with:
1. Executive Summary
2. Key Findings (organized by theme)
3. Detailed Analysis
4. Sources/Citations (if available)
5. Confidence Assessment
6. Recommendations or Next Steps

Format in clean, professional markdown.`,
    temperature: 0.4
  });

  return text;
}
