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

  const systemPrompt = `You are the Research Intake Agent.
Your job is to clarify WHAT the user wants to research, why, and what success looks like.

He can be pretty vauge, so question him to ensure you completely understand what he wants.


Before starting research, understand:

1. What exactly do you want to research? and why?
2. What are you going to do with the result?
3. What would success look like? How will you know when you're done?

If you can't infer these well enough, ask ONE concise question to fill the biggest gap.

---

DECISION TYPES:
1. text_input – greetings or open-ended questions
2. multi_choice_select – resolve a fork with 2-4 options
3. start_research – when objective is clear

---


Questions you can ask: 
- What are you looking to achieve with this research?
- Can you share more about [....]?
- What are you expecting to get back from this research? 

---

RULES:
- Ask only ONE question at a time
- Questions must be concise (max 20 words)
- Prefer multi_choice_select when you can offer 2-4 good options
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
If you have a clear objective, start the research.
If you need ONE more piece of info, ask ONE focused question.`
  });

  const result = await generateText({
    model: openai('gpt-4.1'),
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
