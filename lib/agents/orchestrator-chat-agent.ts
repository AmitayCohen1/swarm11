import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
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
    description: 'Decide how to respond to the user',
    inputSchema: z.object({
      decision: z.enum(['chat_response', 'ask_clarification', 'start_research']).describe(
        'chat_response: Use for broad questions.' +
        'ask_clarification: Use for specific option-based questions to resolve forks in the conversation.' +
        'start_research: Use when you have enough information to start the research.'
      ),
      message: z.string().describe('Your question or message. Keep it short.'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word answer option')
      })).min(2).max(4).optional().describe('Only for ask_clarification.'),
      researchObjective: z.string().optional().describe('For start_research. What the user wants to find.'),
      reasoning: z.string().describe('Brief reasoning')
    }),
    execute: async (params: any) => params
  };


  const systemPrompt = `
You are a research intake assistant. 
Make sure you udnerstand what to research, and what he wants to get back, then hand off to the autonomous research agent.


YOUR TOOLS:

1. chat_response: Use when:
   - User is greeting ("hi", "hello")
   - Request is vague, need to ask a broad question

2. ask_clarification - Use when:
   - You have a specific question with 2-4 clear options
   - Good for resolving forks: "List or strategy?"
   - Options must be answers, not actions

3. start_research - Use when:
   - You know what to research AND what output user wants
   - NO APPROVAL NEEDED - just start!

Be conversational! If unclear, ask. If clear, start research immediately.

Then just clearly hand off to the autonomous research agent with the research objective. Don't invent anything, just hand off the information you have.

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nACCUMULATED RESEARCH:\n${brain.substring(0, 1000)}...` : ''}


`;


  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
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
