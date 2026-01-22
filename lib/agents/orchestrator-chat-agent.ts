import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { parseResearchMemory, formatForOrchestrator } from '@/lib/utils/research-memory';

export interface ResearchAngle {
  name: string;      // Short name: "Platforms", "Newsrooms", etc.
  goal: string;      // What we're looking for via this angle
  stopWhen: string;  // Success criteria OR rejection criteria
}

export interface ResearchBrief {
  objective: string;
  angles: ResearchAngle[];  // 3-5 fixed strategies to try
}

export interface OrchestratorDecision {
  type: 'text_input' | 'multi_choice_select' | 'start_research';
  message: string;
  reasoning: string;
  // multi_choice_select & text_input (when asking)
  reason?: string; // Why this question is being asked - shown to user
  options?: { label: string }[];
  // start_research
  researchBrief?: ResearchBrief;
}

/**
 * Orchestrator Agent - Signal Scout Orchestrator
 * Decomposes intent, defines success criteria, routes work, and enforces output quality.
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string
): Promise<OrchestratorDecision> {

  const decisionTool = {
    description: 'Decide how to respond to the user',
    inputSchema: z.object({
      decision: z.enum(['text_input', 'multi_choice_select', 'start_research']).describe(
        'text_input' +
        'multi_choice_select:' +
        'start_research'
      ),
      message: z.string().describe('Your response or question text.'),

      // For questions (multi_choice_select or text_input when asking)
      reason: z.string().optional().describe('REQUIRED when using text_input or multi_choice_select. Brief explanation of WHY you need this info to proceed. Shown to user.'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word option')
      })).min(2).max(4).optional().describe('REQUIRED for multi_choice_select: 2-4 concrete options'),

      // start_research fields
      researchBrief: z.object({
        objective: z.string().describe("Clear, specific research objective. Include what to find and what the user will do with it."),
        angles: z.array(z.object({
          name: z.string().describe("Short name for this angle (2-3 words). e.g. 'Platforms', 'Newsrooms', 'Trigger events'"),
          goal: z.string().describe("What we're looking for via this angle. e.g. 'Find ops-level owners at podcast platforms + direct outreach path'"),
          stopWhen: z.string().describe("When to stop this angle - success OR rejection. e.g. '10 named contacts OR concluded platforms are gated'")
        })).min(2).max(5).describe("3-5 different ANGLES (strategies) to try. These are fixed - agent explores them systematically.")
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
  You gather information from the user, then pass it to the Autonomous Research Agent.
  Your role is to ensure clarity about what research the user wants.

  The objective you create should only reflect what the user actually said - don't embellish.

  Make sure you understand:
  1. What exactly do we need to research? What type of results are they interested in?
  2. What will they do with the results? This tells us what level of detail is needed.
  3. What does useful output look like? Make it tangible and actionable.
  4. What should research OPTIMIZE FOR? Don't assume - ask if unclear.
     The relevant tradeoffs depend on the request. Figure out what matters for THIS user.

  DECISION TYPES:
  1. multi_choice_select - Use to choose between options. Present 2-4 options.
  2. text_input - Use for greetings or open-ended questions.
  3. start_research - Use when you have a clear, specific objective.

  RULES:
  - Ask only ONE question at a time - short and specific. Be direct and concise.
  - If you give options, use multi_choice_select.
  - Don't invent information or assume.

  WHEN STARTING RESEARCH:
  Create 3-5 ANGLES (strategies) for the agent to explore systematically.
  Angles are FIXED - agent can't add more. They explore and mark each as "worked" or "rejected".

  Each angle needs:
  - name: Short label (2-3 words)
  - goal: What we're looking for via this angle
  - stopWhen: When to stop - EITHER success criteria OR rejection criteria

  Example angles for "find DevRel lead":
  ✅ Platforms angle: "Find DevRel at Datadog/Vercel" → stop when "5 candidates OR concluded these companies are too big"
  ✅ Speakers angle: "Find conference speakers on our topic" → stop when "10 speakers with engagement OR no relevant talks found"
  ✅ Trigger angle: "Find people whose companies just did layoffs" → stop when "3 candidates with timing signal OR no recent layoffs in space"

  Bad angles:
  ❌ "Research the market" (not a strategy, too vague)
  ❌ "Find 10 people" (that's a task, not an angle)
  `;
  

  // Build messages array from conversation history (AI SDK pattern)
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Add recent conversation history
  const recentHistory = conversationHistory.slice(-10);
  for (const m of recentHistory) {
    if (m.role === 'user') {
      // Include selection context for multi-choice responses
      const content = m.metadata?.type === 'option_selected'
        ? `${m.content} (I selected this from: ${m.metadata.offeredOptions?.map((o: any) => o.label).join(', ')})`
        : m.content;
      messages.push({ role: 'user', content });
    } else if (m.role === 'assistant' && m.content) {
      messages.push({ role: 'assistant', content: m.content });
    }
  }

  // Add the current user message with instruction
  messages.push({
    role: 'user',
    content: `${userMessage}

---
If you have a clear objective (what to find + what they'll do with it), start the research.
If you need ONE more piece of info, ask ONE focused question.`
  });

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools: { decisionTool },
    toolChoice: 'required'
  });

  // Extract the decision from tool call
  const toolCall = result.toolCalls?.[0] as any;
  if (toolCall && toolCall.toolName === 'decisionTool') {
    const args = toolCall.args || toolCall.input;
    return {
      type: args.decision,
      message: args.message,
      reasoning: args.reasoning,
      reason: args.reason,
      options: args.options,
      researchBrief: args.researchBrief
    };
  }

  // Fallback: text input
  return {
    type: 'text_input',
    message: 'I can help with research tasks. What would you like me to find or evaluate?',
    reasoning: 'Fallback - unclear intent'
  };
}
