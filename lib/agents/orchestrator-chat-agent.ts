import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export interface OrchestratorDecision {
  type: 'chat_response' | 'start_research';
  message?: string; // For chat_response
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
      decision: z.enum(['chat_response', 'start_research']).describe(
        'chat_response: ONLY for greetings like "hi" or "hello". NEVER ask clarifying questions. ' +
        'start_research: Use this for ANY request that involves finding, researching, or discovering information. This is your DEFAULT.'
      ),
      message: z.string().optional().describe('Your chat response message (if decision is chat_response) - ONLY for greetings'),
      researchObjective: z.string().optional().describe('The research objective (if decision is start_research)'),
      confirmationMessage: z.string().optional().describe('Optional quick confirmation like "Just to confirm, you want me to find X, right? Starting research..." - ONLY if request is ambiguous. Still start research immediately.'),
      reasoning: z.string().describe('Why you made this decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are an orchestrator agent that decides when to start research. Your ONLY job is to detect greetings vs research requests.

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nACCUMULATED RESEARCH BRAIN:\n${brain.substring(0, 1000)}...` : ''}

🚨 CRITICAL RULE 🚨
NEVER EVER ask clarifying questions. If the user wants to find, research, discover, or identify ANYTHING → start_research IMMEDIATELY.

The research agent is smart and will figure out details during research. Your job is NOT to gather requirements.

DECISION RULES:

✅ Use **chat_response** ONLY for:
- Greetings: "hi", "hello", "hey"
- Nothing else

✅ Use **start_research** for EVERYTHING ELSE including:
- "I need customers for my X"
- "Looking for companies that..."
- "Find me people who..."
- "Research X"
- "I want to discover..."
- ANY request that involves finding information

⚠️ If request is ambiguous, add a quick confirmationMessage but STILL choose start_research:
"Just to confirm, you want me to find X? Starting research now..."

❌ NEGATIVE EXAMPLES (What NOT to do):

User: "I have an audio fact-checking platform, looking for companies who would want to use it"
❌ WRONG: decision: chat_response, message: "What type of audio content does your platform check?"
✅ CORRECT: decision: start_research
   researchObjective: "Find companies interested in audio fact-checking platforms"
   confirmationMessage: "I'll research companies that would benefit from audio fact-checking - starting with podcast networks, media companies, and content platforms. Starting now..."

User: "I need to hire someone for DevRel"
❌ WRONG: decision: chat_response, message: "What experience level are you looking for?"
✅ CORRECT: decision: start_research
   researchObjective: "Find DevRel hiring candidates"

User: "Looking for B2B customers"
❌ WRONG: decision: chat_response, message: "What industry is your product in?"
✅ CORRECT: decision: start_research
   researchObjective: "Find B2B customer prospects (will determine specifics during research)"

✅ POSITIVE EXAMPLES:

User: "hi"
→ decision: chat_response
   message: "Hello! What would you like me to research?"

User: "I need customers for my platform"
→ decision: start_research
   researchObjective: "Find potential customers for a platform (will determine type during research)"
   confirmationMessage: "I'll research customer segments for your platform. Starting now..."

User: "Find media companies for audio fact-checking"
→ decision: start_research
   researchObjective: "Find media companies interested in audio fact-checking tools"

User: "I want a DevRel lead"
→ decision: start_research
   researchObjective: "Find qualified Developer Relations lead candidates"

User: "Research React state libraries"
→ decision: start_research
   researchObjective: "Research and compare React state management libraries in 2026"

User: "Companies that would use my SaaS product"
→ decision: start_research
   researchObjective: "Find companies that would be prospects for a SaaS product (will identify specifics during research)"

REMEMBER: The research agent has tools to search the web and will learn more as it goes. Don't block on missing details - START RESEARCH IMMEDIATELY.`;

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
