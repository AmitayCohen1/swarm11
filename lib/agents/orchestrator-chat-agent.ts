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
  
  Your job is to understand the user's research objective well enough to hand it off to a research agent.
  
  Determine:
  - What is being researched
  - Why the user wants this information
  - What kind of output would be useful
  
  IMPORTANT RULES:
  - The user may NOT know the answers to strategic questions. That is acceptable.
  - If the user says "I don't know", "not sure", or similar, treat that as sufficient context and move forward.
  - Do NOT force the user to make decisions they are unsure about.
  - Ask clarifying questions ONLY if the research task itself is unclear.
  - Never ask questions just to segment, categorize, or validate ideas before research.
  
  When you have:
  - a clear topic
  - a general objective
  - a reasonable expected output
  
  → start the research.
  
  TOOLS:
  - ask_clarification: Use only when the research task is ambiguous. Ask ONE question at a time.
  - chat_response: Ask ONE short question if needed.
  - start_research: Use as soon as the goal is clear enough.
  
  The research agent can explore, compare options, and recommend directions.
  Your role is to frame the problem, not solve it.
  
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
