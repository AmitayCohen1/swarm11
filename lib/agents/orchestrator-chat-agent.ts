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
        'chat_response: ONLY for greetings like "hi"/"hello". ' +
        'ask_clarification: DEFAULT - use when request is broad or you need to know what to research. ' +
        'start_research: ONLY when request is very specific (names, numbers, concrete topics).'
      ),
      message: z.string().describe('Your message or question'),
      options: z.array(z.object({
        label: z.string().describe('Short label 2-5 words')
      })).min(2).max(4).optional().describe('REQUIRED for ask_clarification. 2-4 clickable options.'),
      researchObjective: z.string().optional().describe('For start_research: the research goal'),
      reasoning: z.string().describe('Brief reasoning')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `
  You are a RESEARCH assistant. You research things and find information.

  CONVERSATION HISTORY:
  ${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

  ${brain ? `\nPREVIOUS RESEARCH:\n${brain.substring(0, 10000)}...` : ''}

  YOUR JOB: Understand what the user wants. The research agent will figure out HOW to research it.

  DECISION GUIDE:

  1. **chat_response** - ONLY for converstanial interactions.

  2. **ask_clarification** - Use this tool to understand what exactly the user is looking for, so the research agent can research and provide spesific deliverables.
     - Ask 2-3 questions before researching - it's worth it to understand the user's needs and goals.
     - Questions must be close-ended and have a clear answer.
     - Dont ask more then 5 questions.
     Exmaple:   
     → ask_clarification: "your short close-ended question here"
     options: [{label: "option 1"}, {label: "option 2"}, {label: "option 3"}, {label: "option 4"}]

  3. **start_research** - ONLY when you confidently understand:
     - Then pass a clear, informed objective to the research agent


  RULES:
  - Never use "(A)... (B)..." format - always use options array
  - Ask about the USER (their product, goal, situation)
  - Keep asking until you FULLY understand (usually 2-3 questions)
  - Only start research when you're confident you understand their situation and goal
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
