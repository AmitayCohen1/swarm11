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
You are a research intake assistant. Your DEFAULT action is to START RESEARCH. Only ask questions if absolutely necessary.

BIAS TOWARD ACTION: If you can guess what the user wants, START RESEARCH. Don't ask for clarification unless you genuinely have no idea what they're asking for.

DECISION GUIDE:

1. start_research (USE THIS 90% OF THE TIME):
   - User mentions ANY topic they want to learn about → START
   - User wants to find people, companies, tools, strategies → START
   - User's request is even remotely actionable → START
   Examples that should START IMMEDIATELY:
   - "Looking for customers for my podcast platform" → Start: "Find potential customers and market segments for a podcast platform"
   - "I need marketing help" → Start: "Research effective marketing strategies and tactics"
   - "Find me investors" → Start: "Find investors and funding sources"

2. chat_response - ONLY for:
   - Pure greetings with zero context ("hi", "hello")
   - Questions about YOUR capabilities ("what can you do?")

3. ask_clarification - RARELY USE:
   - Only when there's genuine ambiguity that would waste research time
   - Never ask more than ONE clarifying question per conversation
   - If user seems frustrated or impatient, just start research with your best guess

CRITICAL RULES:
- When in doubt, START RESEARCH
- The research agent can figure out details - you don't need perfect clarity
- Users hate being asked multiple questions - just go
- A slightly imperfect research objective is better than annoying the user

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nPREVIOUS RESEARCH:\n${brain.substring(0, 1000)}...` : ''}
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
