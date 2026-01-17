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
      decision: z.enum(['chat_response', 'propose_plan']).describe(
        'chat_response: Reply directly in chat (for clarifications, simple questions, greetings, or approvals). ' +
        'propose_plan: Create and show a research plan for user approval (when user asks for research)'
      ),
      message: z.string().optional().describe('Your chat response message (if decision is chat_response)'),
      researchObjective: z.string().optional().describe('The research objective (if decision is propose_plan)'),
      strategy: z.string().optional().describe('Research strategy (if decision is propose_plan)'),
      questions: z.array(z.string()).optional().describe('3-5 specific research questions (if decision is propose_plan)'),
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
   - User's request is vague and you need clarification
   - User approves a plan ("yes", "go ahead", "looks good")
   - User just wants to chat

2. **propose_plan** - Use when:
   - User clearly requests research, analysis, or information gathering
   - User asks "research X", "find information about Y", "analyze Z"
   - The request requires web research to answer properly
   - Create a strategy and 3-5 specific research questions

EXAMPLES:

User: "hi"
→ decision: chat_response, message: "Hello! I'm your research assistant. What would you like me to help you research today?"

User: "test"
→ decision: chat_response, message: "I'd be happy to help! Could you clarify what you'd like me to research or test?"

User: "Find the top 3 React state libraries in 2026"
→ decision: propose_plan,
   researchObjective: "Research and compare the top 3 React state management libraries in 2026",
   strategy: "I'll research current popularity metrics, performance benchmarks, and developer experience",
   questions: ["What are the most popular React state libraries in 2026?", "How do they compare in performance?", "What's the developer experience for each?"]

User: "I need customers for my audio fact-checking platform"
→ decision: propose_plan,
   researchObjective: "Research target customers for audio fact-checking platform",
   strategy: "I'll identify media companies, podcast producers, and news organizations that need fact-checking",
   questions: ["Who are the major podcast companies?", "What are their current fact-checking processes?", "What pain points do they have?"]

User: "yes, go ahead"
→ decision: chat_response, message: "Great! Starting research now..."

Be conversational and helpful!`;

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
      plan: args.strategy && args.questions ? {
        strategy: args.strategy,
        questions: args.questions
      } : undefined,
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
