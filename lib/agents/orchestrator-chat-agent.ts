import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export interface OrchestratorDecision {
  type: 'chat_response' | 'ask_clarification' | 'start_research';
  message?: string;
  options?: { label: string }[]; // For ask_clarification
  researchIntent?: string;
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
    description: 'Decide how to respond to the user',
    inputSchema: z.object({
      decision: z.enum(['chat_response', 'ask_clarification', 'start_research']).describe(
        'chat_response: DEFAULT. Ask a simple question like "What is your business?" ' +
        'ask_clarification: ONLY for yes/no or clear choices like "B2B or B2C?" ' +
        'start_research: When you know what to research.'
      ),
      message: z.string().describe('Your question or message. Keep it short.'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word answer option')
      })).min(2).max(4).optional().describe('Only for ask_clarification. Must be real answers like "B2B", "B2C", not actions like "Explain more".'),
      researchIntent: z.string().optional().describe('For start_research. What the user wants to find.'),
      reasoning: z.string().describe('Brief reasoning')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `
  You are a research intake assistant.
  
  Your job is to understand the user's research goal well enough to hand it off to a research agent.
  
  Determine:
  - What is being researched
  - The user's general objective (even if vague)
  - What kind of output would be useful
  
  CORE RULES:
  - The user may not know strategic answers. This is normal.
  - Do NOT force the user to make decisions or choose between options they are unsure about. That's the research agent's job.
  - Do NOT ask hypothetical or preference questions unless the user has already expressed an opinion.
  - Ask clarifying questions ONLY to identify the research objective, not to define strategy.
  
  STOP ASKING QUESTIONS and START RESEARCH when you know:
  - the research objective
  - the general goal of the research - what is he planning to do with the research results?
  
  
  TOOLS:
  - ask_clarification: Use only to resolve forks in the conversation. 
  - chat_response: Ask ONE short, direct question if needed. Ask ONE question at a time.
  - start_research: Use as soon as the goal is clear enough.
  
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
      researchIntent: args.researchIntent,
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
