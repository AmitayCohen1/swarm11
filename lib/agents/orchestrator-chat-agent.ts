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

  const systemPrompt = `You are an orchestrator agent that decides when to start research. Your job is to understand what the user wants and either ask clarification or start research.

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nACCUMULATED RESEARCH BRAIN:\n${brain.substring(0, 1000)}...` : ''}

DECISION RULES:

✅ Use **chat_response** ONLY for:
- Greetings: "hi", "hello", "hey"

✅ Use **ask_clarification** when:
- You don't understand what success looks like for this task
- You don't know what would make a result useful vs useless
- When in doubt, ASK! Better to clarify than research the wrong thing.

Key question to ask yourself:
"If I return results, what will the user actually DO with them?"

If you can't answer that, ask the user.

✅ Use **start_research** when:
- You understand what a good deliverable looks like for this specific user
- You know what would make the result actionable vs impressive-but-useless
- You can picture what success looks like

EXAMPLES:

User: "hi"
→ decision: chat_response
   message: "Hello! What would you like me to research?"

User: "I need customers"
→ decision: ask_clarification
   message: "I can help! What will you do with the results once I find them?"
   reasoning: "Can't determine what success looks like without knowing their intent"

User: "I need customers for my audio platform"
→ decision: ask_clarification
   message: "Got it. What would a good result look like for you?"
   reasoning: "Know what they want, but not what makes it useful to them"

User: "Find me 10 podcast studios I can email this week"
→ decision: start_research
   researchObjective: "Find 10 podcast studios that are contactable via email"
   reasoning: "Clear success criteria: specific number, contactable, immediate use"

User: "Research React state libraries"
→ decision: start_research
   researchObjective: "Research and compare React state management libraries"
   reasoning: "Exploratory research - success is understanding the options"

REMEMBER: Ask ONE question that helps you understand what success looks like.`;

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
