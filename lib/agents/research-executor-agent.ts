import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { tavilySearch } from '@/lib/tools/tavily-search';
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
    onProgress,
    abortSignal
  } = config;

  let totalCreditsUsed = 0;
  const MAX_STEPS = 30;

  const updateBrainTool = tool({
    description: 'Manage the research knowledge base.',
    inputSchema: z.object({
      action: z.enum(['add_resource', 'add_insight', 'update_plan', 'log_finding']),
      data: z.any(),
      reasoning: z.string()
    }),
    execute: async ({ action, data, reasoning }) => {
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';
      
      if (!currentBrain.includes('# OBJECTIVE')) {
        currentBrain = `# OBJECTIVE\n${researchObjective}\n\n# FINDINGS\n\n# INSIGHTS\n\n# NOTES\n`;
      }

      let updatedBrain = currentBrain;

      if (action === 'add_resource') {
        // Format resource as clean markdown
        let entry = '\n';

        if (data.name && !data.category) {
          // Simple resource: person or company
          entry += `**${data.name}**`;
          if (data.title || data.role) entry += ` - ${data.title || data.role}`;
          if (data.company) entry += ` @ ${data.company}`;
          entry += '\n';
          if (data.details) entry += `  ${data.details}\n`;
          if (data.contact || data.email || data.linkedin) {
            entry += `  Contact: ${data.contact || data.email || data.linkedin}\n`;
          }
        } else if (data.category && data.entities) {
          // Category with multiple entities
          entry += `### ${data.category}\n\n`;
          data.entities.forEach((entity: any) => {
            entry += `**${entity.name}**\n`;
            if (entity.details) entry += `  ${entity.details}\n`;
            if (entity.contact_potential) entry += `  *Fit: ${entity.contact_potential}*\n`;
            entry += '\n';
          });
        } else {
          // Fallback
          entry += `**Finding**: ${data.details || JSON.stringify(data)}\n`;
        }

        const idx = updatedBrain.indexOf('# INSIGHTS');
        updatedBrain = updatedBrain.slice(0, idx) + entry + updatedBrain.slice(idx);
      } else if (action === 'add_insight') {
        const entry = `\n- ${data.content || JSON.stringify(data)}`;
        const idx = updatedBrain.indexOf('# NOTES');
        updatedBrain = updatedBrain.slice(0, idx) + entry + '\n' + updatedBrain.slice(idx);
      } else {
        updatedBrain += `\n- ${JSON.stringify(data)}`;
      }

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: updatedBrain });

      return { success: true };
    }
  });

  const askUserTool = tool({
    description: 'Ask the user a question when you need clarification or direction. Use this when unsure which path to take or need more context.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the user'),
      context: z.string().describe('Why are you asking this? What will you do with the answer?')
    }),
    execute: async ({ question, context }) => {
      // Emit question to user via chat
      onProgress?.({
        type: 'agent_question',
        question,
        context
      });

      return {
        acknowledged: true,
        note: 'Question sent to user. Wait for their response before proceeding.'
      };
    }
  });

  const reflectionTool = tool({
    description: 'REQUIRED after EVERY search() - Evaluate and decide next move.',
    inputSchema: z.object({
      evaluation: z.string(),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete', 'ask_user']),
      reasoning: z.string(),
      nextQuery: z.string().optional()
    }),
    execute: async ({ evaluation, nextMove, reasoning, nextQuery }) => {
      const timestamp = new Date().toLocaleTimeString();
      const reflection = `\n**[${timestamp}] Reflection:**\n- ${evaluation}\n- Next: ${nextMove}\n- ${reasoning}\n${nextQuery ? `- Query: "${nextQuery}"\n` : ''}`;

      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const updatedBrain = (session?.brain || '') + reflection;

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit brain update
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
  MISSION:
  "${researchObjective}"
  
  ROLE:
  You are an autonomous research agent. Your sole responsibility is to achieve the mission with accuracy, depth, and efficiency.
  
  AVAILABLE TOOLS:
  - search(query): This tools allows you to research the web to get information.
  - reflect(evaluation, nextMove, reasoning, nextQuery): This tool allows you to analyze the results of your search and decide the optimal next step.
  - saveToBrain(action, data, reasoning): This tool allows you to save the results of your search to the brain.
  - askUser(question, context): This tool allows you to ask the user a question to get clarification.
  - complete(keyFindings, recommendedActions, confidenceLevel): This tool allows you to deliver the final, structured outcomes.
  
  RESEARCH OPERATING PRINCIPLES:
  1. Prioritize signal over noise. Ignore low-quality or redundant information.
  2. Seek concrete, verifiable facts before drawing conclusions.
  3. Iterate deliberately: search → reflect → refine or double down.
  4. Think laterally when direct answers are unavailable.
  `;
  
  try {
    const agent = new ToolLoopAgent({
      model: anthropic('claude-sonnet-4-20250514'),
      instructions,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      onStepFinish: async ({ text, toolCalls, toolResults, usage }) => {
        const [sessionCheck] = await db
          .select({ status: chatSessions.status })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        if (sessionCheck?.status !== 'researching') {
          throw new Error('Research stopped by user');
        }

        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;
        await deductCredits(userId, stepCredits);

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
              onProgress?.({
                type: 'search_result',
                query: (result as any).input?.query,
                answer: toolResult?.answer || '',
                sources: toolResult?.sources || []
              });
            }
          }
        }
      }
    });

    const result = await agent.generate({
      prompt: `Research: "${researchObjective}"\n\nStart with search().`
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
