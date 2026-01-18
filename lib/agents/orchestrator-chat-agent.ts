import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export interface OrchestratorDecision {
  type: 'chat_response' | 'ask_clarification' | 'start_research';
  message?: string; // For chat_response or ask_clarification
  researchObjective?: string; // For start_research
  confirmationMessage?: string; // Optional quick confirmation before research
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
    description: 'Make a decision about how to respond to the user message',
    inputSchema: z.object({
      decision: z.enum(['chat_response', 'ask_clarification', 'start_research']).describe(
        'chat_response: ONLY for greetings like "hi" or "hello". ' +
        'ask_clarification: Ask a specific question to clarify the research objective before starting. ' +
        'start_research: Use this when you have enough information to start research.'
      ),
      message: z.string().optional().describe('Your message (for chat_response or ask_clarification)'),
      researchObjective: z.string().optional().describe('The research objective (if decision is start_research)'),
      confirmationMessage: z.string().optional().describe('Optional quick confirmation before starting research'),
      reasoning: z.string().describe('Why you made this decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `
  You are an orchestrator agent that decides when to start research.
  Your job is to understand what the user wants and decide whether to ask one clarifying question or start research.
  
  CONVERSATION HISTORY:
  ${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}
  
  ${brain ? `\nACCUMULATED RESEARCH BRAIN:\n${brain.substring(0, 1000)}...` : ''}
  
  DECISION RULES:
  
  ✅ Use **chat_response** ONLY for:
  - Greetings: "hi", "hello", "hey"
  
  ✅ Use **ask_clarification** when:
  - You cannot clearly picture ONE concrete version of success
  - The task could reasonably be done in more than one strategic way
  - You are unsure which direction would be most useful
  
  Ask ONE concise question that resolves the fork.
  If still unclear after the answer, ask ONE more question.
  
  
  ✅ Use **start_research** when:
  - You can clearly picture what success looks like
  - You know what would be useful vs useless
  - The strategic direction is clear
  
  Your job:
  Figure out what success looks like *before* research starts.
  
  EXAMPLES:
  
  User: "hi"
  → decision: chat_response
  
  User: "I need customers"
  → decision: ask_clarification
     message: "Should I prioritize customers that are easy to start with, or the biggest players in the space?"
  
  User: "Find me 10 people I can email this week"
  → decision: start_research
     researchObjective: "Find 10 people I can email this week"
  
  User: "Research React state libraries"
  → decision: start_research
     researchObjective: "Research React state libraries"
  
  WRONG:
  ❌ Starting research when multiple strategic paths exist
  ❌ Asking many questions
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
      researchObjective: args.researchObjective,
      confirmationMessage: args.confirmationMessage,
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
