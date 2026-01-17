import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export interface OrchestratorDecision {
  type: 'chat_response' | 'start_research';
  message?: string; // For chat_response
  researchObjective?: string; // For start_research
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
      decision: z.enum(['chat_response', 'start_research']).describe(
        'chat_response: Reply directly in chat (for clarifications, simple questions, greetings). ' +
        'start_research: Start research immediately (when user clearly requests research)'
      ),
      message: z.string().optional().describe('Your chat response message (if decision is chat_response)'),
      researchObjective: z.string().optional().describe('The research objective (if decision is start_research)'),
      reasoning: z.string().describe('Why you made this decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are an orchestrator agent that analyzes user messages and decides how to respond.

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nACCUMULATED RESEARCH BRAIN:\n${brain.substring(0, 1000)}...` : ''}

DECISION RULES:

1. **chat_response** - Use when:
   - User is greeting you ("hi", "hello")
   - User asks a simple question you can answer directly
   - User's request is vague and you need clarification - ASK questions to understand better
   - User just wants to chat

2. **start_research** - Use when:
   - User clearly requests research, analysis, or information gathering
   - User asks "research X", "find information about Y", "analyze Z"
   - The request is specific enough to start researching immediately
   - NO PLAN APPROVAL NEEDED - just start!

EXAMPLES:

User: "hi"
→ decision: chat_response, message: "Hello! I'm your research assistant. What would you like me to research today?"

User: "I need customers for my platform"
→ decision: chat_response, message: "I'd be happy to research potential customers! What type of platform is it and what industry or market are you targeting?"

User: "Find customers for my audio fact-checking platform"
→ decision: start_research, researchObjective: "Research target customers for audio fact-checking platform"

User: "Research the top 3 React state libraries in 2026"
→ decision: start_research, researchObjective: "Research and compare the top 3 React state management libraries in 2026"

Be conversational! If unclear, ask questions. If clear, start research immediately!`;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    prompt: `User message: "${userMessage}"

Analyze this message and decide how to respond.`,
    tools: { decisionTool }
  });

  // Extract the decision from tool call
  const toolCall = result.toolCalls?.[0] as any;
  if (toolCall && toolCall.toolName === 'decisionTool') {
    const args = toolCall.args || toolCall.input;
    return {
      type: args.decision,
      message: args.message,
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
