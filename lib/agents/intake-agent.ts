import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

/**
 * Research Brief - simplified for Cortex architecture
 * Intake extracts WHAT (objective + criteria)
 * Cortex decides HOW (generates initiatives)
 */
export interface ResearchBrief {
  objective: string;
  successCriteria: string[];
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
 * Intake Agent
 * Clarifies intent and extracts research objective + success criteria.
 * Does NOT plan HOW to research - that's Cortex's job.
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

      // start_research fields - just objective and success criteria
      researchBrief: z.object({
        objective: z.string().describe("Clear, specific research objective in user's words."),
        successCriteria: z.array(z.string()).min(1).max(4).describe("1-4 specific criteria for success. E.g., 'Find at least 5 candidates', 'Identify pricing for top 3'"),
      }).optional().describe('Required for start_research.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Intake Agent before the research starts.

Your job is to get prepeared for a long research. Ask any question that could help us understand the user needs better, or anything that could reveal more about his needs.

Ask him until you are sure you understand:
1. What he expect to get back from the research? How does success look like?
2. Why he wants to do this research? What the reason? What does he plan to do with the research outputs?
3. Any question that you think is relevant to the research?


---

DECISION TYPES:
1. text_input – direct answers, analysis, or a single clarifying question
2. multi_choice_select – resolve ambiguity with 2–4 concrete options
3. start_research – only when all three questions are clear

---

QUESTION RULES:
- Ask only ONE question at a time.
- Max 20 words for every question.
- Use multi_choice_select. Only if something is deeply unclear, use text_input only if it's absolutely necessary.
`;

  // Build messages array from conversation history
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Full conversation history - intake needs to remember all clarifying Q&A
  const recentHistory = conversationHistory;
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
If you have a clear objective, start the research.
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
