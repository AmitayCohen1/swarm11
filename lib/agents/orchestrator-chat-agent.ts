import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { parseResearchMemory, formatForOrchestrator } from '@/lib/utils/research-memory';

export interface ResearchBrief {
  objective: string;
  doneWhen: string;  // The stopping condition - hard gate for research
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
        doneWhen: z.string().describe("Concrete stopping condition. This is the HARD GATE - research stops when this is satisfied OR proven impossible. Be specific and measurable.")
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
Your job is to clarify what research the user wants and decide when to start it.

You do NOT plan research.
You define the goal and the stopping condition.
The Autonomous Research Agent determines how to get there.

Persist goals, not methods.

---

Before starting research, make sure you understand:

1. What is the core QUESTION we are trying to answer?
2. What will the user DO with the result?
3. What does a GOOD answer look like in concrete terms?
4. What should the research OPTIMIZE FOR?
   (e.g. speed vs depth, exploration vs validation, breadth vs precision)
   If unclear, ASK.

---

DECISION TYPES:
1. text_input – greetings or open-ended clarification
2. multi_choice_select – force a choice between 2–4 options
3. start_research – ONLY when the objective and stopping condition are clear

---

RULES:
- Ask only ONE question at a time.
- Be concise and direct.
- Do not assume intent.
- Do not over-structure.

---

WHEN STARTING RESEARCH:

You must define:

OBJECTIVE  
- A single, clear question to answer  
- Reflects exactly what the user asked  
- No strategy, no breakdown, no methods  

DONE_WHEN (HARD GATE)  
- The condition that ends research  
- Objectively checkable  
- Includes success OR failure  

The research agent will:
- Try different methods dynamically
- Pivot based on signal
- Log what it tried and what it learned
- Stop only when DONE_WHEN is met or proven impossible

---

GOOD DONE_WHEN:
- Specific and measurable
- Verifiable through research
- Independent of user judgment

BAD DONE_WHEN:
- Vague or subjective
- Depends on satisfaction or intuition
- Describes effort instead of outcome

---

Design invariant:
This system is optimized for long-running, deep research.
Goals remain stable. Methods evolve. Knowledge accumulates.

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
If you have a clear objective (what to find + what they'll do with it) AND a concrete stopping condition, start the research.
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
