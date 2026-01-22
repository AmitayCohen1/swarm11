import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { parseResearchMemory, formatForOrchestrator } from '@/lib/utils/research-memory';

export interface ResearchInitiative {
  question: string;
  doneWhen: string;
}

export interface ResearchBrief {
  objective: string;
  initiatives: ResearchInitiative[];
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
        initiatives: z.array(z.object({
          question: z.string().describe("Specific question to answer. Must be standalone and searchable."),
          doneWhen: z.string().describe("When there's ENOUGH SIGNAL to decide - either found what's needed OR learned why this path doesn't work. e.g. 'Identified specific candidate with opening signal' or 'Determined if this market has accessible buyers'")
        })).length(1).describe("ONE focused initiative. Agent can add more during research.")
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
  You gather information from the user, then pass it to the Autonomous Research Agent.
  Your role is to ensure clarity about what research the user wants.

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
  Create ONE focused initiative with concrete doneWhen criteria.
  The agent can add more initiatives during research if needed.

  doneWhen = enough SIGNAL to decide (success OR learned why it won't work):
  ✅ "Identified candidate with opening signal, or concluded this pool lacks quality"
  ✅ "Found accessible decision-maker, or determined this market is gated"
  ❌ "Find 5 companies" (count-based, ignores signal quality)
  ❌ "Research the market" (no clear decision point)
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
