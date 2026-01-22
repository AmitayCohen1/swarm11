import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export interface InitialStrategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

export interface ResearchBrief {
  objective: string;
  doneWhen: string;
  initialStrategy: InitialStrategy;
}

export interface OrchestratorDecision {
  type: 'text_input' | 'multi_choice_select' | 'start_research';
  message: string;
  reasoning: string;
  reason?: string;
  options?: { label: string }[];
  researchBrief?: ResearchBrief;
}

/**
 * Orchestrator Agent
 * Clarifies intent, defines goals, and kicks off research with a plan.
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string
): Promise<OrchestratorDecision> {

  const decisionTool = {
    description: 'Decide how to respond to the user',
    inputSchema: z.object({
      decision: z.enum(['text_input', 'multi_choice_select', 'start_research']),
      message: z.string().describe('Your response or question text.'),

      // For questions
      reason: z.string().optional().describe('Why you need this info. Shown to user.'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word option')
      })).min(2).max(4).optional().describe('Required for multi_choice_select'),

      // start_research fields
      researchBrief: z.object({
        objective: z.string().describe("Clear, specific research objective."),
        doneWhen: z.string().describe("Concrete stopping condition. Research stops when this is satisfied OR proven impossible."),
        initialStrategy: z.object({
          approach: z.string().describe("High-level research approach (e.g., 'Compare pricing across top 3 competitors')"),
          rationale: z.string().describe("Why this approach makes sense for the objective"),
          nextActions: z.array(z.string()).min(1).max(3).describe("1-3 specific first steps to take")
        }).describe("The initial plan for how to approach this research")
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
Your job is to clarify what research the user wants and kick it off with a smart initial plan.

---

Before starting research, make sure you understand:

1. What is the core QUESTION we are trying to answer?
2. What will the user DO with the result?
3. What does a GOOD answer look like?

---

DECISION TYPES:
1. text_input – greetings or open-ended clarification
2. multi_choice_select – force a choice between 2–4 options
3. start_research – when objective and stopping condition are clear

---

WHEN STARTING RESEARCH:

You must define:

OBJECTIVE
- A single, clear question to answer
- Reflects exactly what the user asked

DONE_WHEN (HARD GATE)
- The condition that ends research
- Objectively checkable
- Includes success OR failure criteria

INITIAL_STRATEGY
- approach: Your high-level plan (1 sentence)
- rationale: Why this approach makes sense
- nextActions: 1-3 specific first searches to run

GOOD INITIAL STRATEGIES:
- "Start with official sources, then expand to reviews" → nextActions: ["Search CompanyX official pricing", "Search CompanyX pricing reviews"]
- "Compare top players first, then dig into specifics" → nextActions: ["Find top 5 competitors in space", "Compare their core offerings"]
- "Find authoritative sources, verify with multiple" → nextActions: ["Search for official documentation", "Search for expert analyses"]

BAD INITIAL STRATEGIES:
- Generic: "Search the web" or "Do research"
- Too broad: "Find everything about X"
- No clear first step

---

RULES:
- Ask only ONE question at a time
- Be concise and direct
- When starting research, provide a SMART initial strategy based on what you know about the user's goal
`;

  // Build messages array from conversation history
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const recentHistory = conversationHistory.slice(-10);
  for (const m of recentHistory) {
    if (m.role === 'user') {
      const content = m.metadata?.type === 'option_selected'
        ? `${m.content} (I selected this from: ${m.metadata.offeredOptions?.map((o: any) => o.label).join(', ')})`
        : m.content;
      messages.push({ role: 'user', content });
    } else if (m.role === 'assistant' && m.content) {
      messages.push({ role: 'assistant', content: m.content });
    }
  }

  messages.push({
    role: 'user',
    content: `${userMessage}

---
If you have a clear objective AND stopping condition, start the research with a smart initial strategy.
If you need ONE more piece of info, ask ONE focused question.`
  });

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools: { decisionTool },
    toolChoice: 'required'
  });

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

  return {
    type: 'text_input',
    message: 'I can help with research tasks. What would you like me to find?',
    reasoning: 'Fallback - unclear intent'
  };
}
