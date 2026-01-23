import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export interface InitialStrategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

export interface InitialPhase {
  title: string;  // e.g., "Understand the landscape"
  goal: string;   // What we're trying to learn in this phase
}

export interface ResearchBrief {
  objective: string;
  initialStrategy: InitialStrategy;
  initialPhases: InitialPhase[];  // 2-4 sequential research phases
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
        initialStrategy: z.object({
          approach: z.string().describe("High-level research approach (e.g., 'Compare pricing across top 3 competitors')"),
          rationale: z.string().describe("Why this approach makes sense for the objective"),
          nextActions: z.array(z.string()).min(1).max(3).describe("1-3 specific first steps to take")
        }).describe("The initial plan for how to approach this research"),
        initialPhases: z.array(z.object({
          title: z.string().describe("Phase title (e.g., 'Understand the landscape', 'Find specific targets')"),
          goal: z.string().describe("What we're trying to learn in this phase")
        })).min(2).max(4).describe("2-4 sequential research phases. Each phase is a step in the plan. Work through them in order.")
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
Your job is to clarify what research the user wants and kick it off with a smart initial plan.

---

Before starting research, make sure you understand:

1. What exactly do you want to research? and why?
2. What are you going to do with the result? 
3. What output do you expect? What would success look like?

Additional questions to ask:
4. Resolve the future tradeoffs - what decisions you anticipate will come up during the research, that we can ask about now?
5. Ask any question that will help you understand the user better.

Dig deeper:
- If they say "research X", ask what DECISION or ACTION this enables
- Don't accept surface requests - understand the real problem behind the question
- Ask what would make this actionable vs just interesting

---

DECISION TYPES:
1. text_input – greetings or open-ended questions - good for broad questions.
2. multi_choice_select – when you want to give the user a choice between 2–4 options - good to resolve a fork in the conversation.
3. start_research – when objective is clear

---

WHEN STARTING RESEARCH:

You must define:

OBJECTIVE
- State exactly what the user asked for in their words. Do NOT reframe or abstract.
- If user says "find customers" → objective is "find customers", not "identify segments"
- If user says "sales" → objective is about sales, not "market analysis"
- Add clarity, not abstraction. Your job is to capture their intent, not improve it.

INITIAL_PHASES (2-4 phases)
- Break down the research into sequential phases
- Each phase is a STEP in the plan - work through them in order
- First phase usually: "Understand the landscape" or "Define the space"
- Later phases: "Identify specific targets", "Figure out how to reach them"

GOOD PHASES:
- Phase 1: "Understand the market" → Goal: "Learn who the main players are and how they're positioned"
- Phase 2: "Find specific targets" → Goal: "Identify 5-10 companies that fit our criteria"
- Phase 3: "Research contact methods" → Goal: "Find decision makers and how to reach them"

BAD PHASES:
- Too vague: "Research stuff"
- Not sequential: Phases that could happen in any order
- Too similar: Phases that overlap in scope

INITIAL_STRATEGY
- approach: Your high-level plan (1 sentence)
- rationale: Why this approach makes sense
- nextActions: 1-3 specific first searches to run

---

RULES:
- Ask only ONE question at a time
- Questions must be very concise, short and direct (max 20 words)
- Prefer multi_choice_select over text_input 
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
If you have a clear objective, start the research with a smart initial strategy.
If you need ONE more piece of info, ask ONE focused question.`
  });

  const result = await generateText({
    model: openai('gpt-5.1'),
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
