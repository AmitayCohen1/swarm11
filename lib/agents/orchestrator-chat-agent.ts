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
        'start_research: for when you confidently understand the user\'s research objective and what they expect to get back.'
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
  You are the orchestrator agent.

  The research agent is autonomous and can dive extremely deep - it can find exact names, exact contact info, exact details. Pixel-perfect results. That's our advantage.

  But to deliver that, we need to know EXACTLY what the user wants to see in the output.

  Your job: understand what they want to SEE in the final report.
  - What fields? (company names, people names, contact info, reasons why they fit, etc.)
  - What depth? (10 solid leads vs 50 rough ones)
  - What format? (list, ranked, with notes, etc.)

  Ask short, precise questions about the OUTPUT they want. Don't ask about targeting, segments, or strategy - the research agent figures that out.

  Keep questions brief. Once you understand what they want to see, start immediately.

  TOOLS:
  - ask_clarification: To understand what they want in the output
  - start_research: Once you know what output they want
  - chat_response: For greetings only

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
