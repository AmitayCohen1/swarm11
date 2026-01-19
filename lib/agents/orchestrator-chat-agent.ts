import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export interface OrchestratorDecision {
  type: 'chat_response' | 'ask_clarification' | 'start_research';
  message?: string;
  options?: { label: string }[]; // For ask_clarification
  researchObjective?: string;
  reasoning: string;
}

/**
 * Orchestrator Agent - Analyzes user messages and decides next action
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string
): Promise<OrchestratorDecision> {

  const decisionTool = {
    description: 'Decide how to respond',
    inputSchema: z.object({
      decision: z.enum(['chat_response', 'ask_clarification', 'start_research']).describe(
        'chat_response: for free-form interactions. ' +
        'ask_clarification: if you want to resolve a fork in the conversation. ' +
        'start_research: for when you confidently understand the user\'s research objective.'
      ),
      message: z.string().describe('Your message or question'),
      options: z.array(z.object({
        label: z.string().describe('Short label 2-5 words')
      })).min(2).max(4).optional().describe('REQUIRED for ask_clarification. 2-4 options.'),
      researchObjective: z.string().optional().describe('For start_research: the research objective'),
      reasoning: z.string().describe('Brief reasoning')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `
  You are the ORCHESTRATOR agent.
  
  Your role is to interpret the user's intent and decide how to proceed.
  
  You must choose ONE of the following actions using the decision tool.
  
  Available tool:
  - decisionTool
  
  decisionTool options:
  - chat_response  
    Use when you should respond normally without starting research.
  
  - ask_clarification  
    Use when the user's intent is ambiguous and a single short question is required
    to determine the correct research objective.
    You MUST provide 2–4 short options.
  
  - start_research  
    Use when you clearly understand what the user wants researched.
    You MUST provide a precise researchObjective for the RESEARCHER agent.
  
  You do NOT perform research yourself.
  You only decide how the system should move forward.
  
  CONVERSATION HISTORY:
  ${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}
  
  ${brain ? `\nPREVIOUS RESEARCH:\n${brain.substring(0, 10000)}...` : ''}
  `;
  
  
  const result = await generateText({
    model: openai('gpt-5.1'),
    system: systemPrompt,
    prompt: `User message: "${userMessage}"

Analyze this message and decide how to respond.`,
    tools: { decisionTool },
    toolChoice: 'required',
    maxToolRoundtrips: 1
  });

  // Extract the decision from tool call
  const toolCall = result.toolCalls?.[0] as any;
  if (toolCall && toolCall.toolName === 'decisionTool') {
    const args = toolCall.args || toolCall.input;
    return {
      type: args.decision,
      message: args.message,
      options: args.options,
      researchObjective: args.researchObjective,
      reasoning: args.reasoning
    };
  }

  // Fallback: treat as chat response
  return {
    type: 'chat_response',
    message: result.text || 'I need more information to help you. Could you clarify what you\'d like me to research?',
    reasoning: 'Fallback response'
  };
}
