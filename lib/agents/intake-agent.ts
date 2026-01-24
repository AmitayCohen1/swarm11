import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

/**
 * Research Brief - simplified for Brain architecture
 * Intake extracts WHAT (objective + criteria)
 * Brain decides HOW (generates research questions)
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
 * Does NOT plan HOW to research - that's Brain's job.
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

  const systemPrompt = `You are the research intake agent.
  You are the first step user will take when he wants to research something. After talking to you, the research agent will start researching.
  Your job is to ensure the research agent have enough information to perform the research and provide relevant results.

  Specifically, the research agent needs to know:
  - What he needs to research? 
  - What the user expects to get from the research?
  - Any valuebale inforamtion that could understand the problem better and support the research?
  - Make sure the research agnet wont get confused, ask clarifying questions if needed.

  You can use: 
  - text_input to ask a broad question, where the user type a full response.
  - multi_choice_select to offer options, where the user can select one of the options.
  - start_research to start the research, once you have enough information to start the research.

Rules:
- One question per turn
- Max 20 words per question
 Use multi_choice_select for normal questions.
 - Use text_input if you fundamentaly don't understand something, and you want a longer response from user.
 - Dont ask questions, that can be resolved during the research.
 - Once you have enough information to start the research, use start_research.

  `;
  
  //  We want to udnerstand him. Not start narrowing down the research.
  //   Our job is to understand the user. Not to start the research. - he used to try narrow down things for me.

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // Full conversation history - intake needs to remember all clarifying Q&A
  const recentHistory = conversationHistory;
  for (const m of recentHistory) {
    if (m.role === 'user') {
      const content = (() => {
        if (m.metadata?.type !== 'option_selected') return m.content;

        const offeredLabels: string[] = Array.isArray(m.metadata.offeredOptionLabels)
          ? m.metadata.offeredOptionLabels
          : (m.metadata.offeredOptions?.map((o: any) => o?.label).filter(Boolean) ?? []);

        const selected = (m.metadata.selectedOption || m.content || '').toString();

        const unselectedLabels: string[] = Array.isArray(m.metadata.unselectedOptionLabels)
          ? m.metadata.unselectedOptionLabels
          : offeredLabels.filter(l => l !== selected);

        const question = m.metadata.originalQuestion ? ` Q: ${m.metadata.originalQuestion}` : '';

        const offered = offeredLabels.length ? ` Offered: ${offeredLabels.join(', ')}.` : '';
        const unselected = unselectedLabels.length ? ` Not chosen: ${unselectedLabels.join(', ')}.` : '';

        // Keep it compact but explicit: chosen vs not chosen carry signal.
        return `${selected}.${offered}${unselected}${question}`.trim();
      })();
      messages.push({ role: 'user', content });
    } else if (m.role === 'assistant' && m.content) {
      // Include context about what type of question was asked
      let content = m.content;
      if (m.metadata?.type === 'multi_choice_select' && m.metadata?.options?.length) {
        const optionLabels = m.metadata.options.map((o: any) => o.label).join(', ');
        content = `${m.content} [OPTIONS: ${optionLabels}]`;
      }
      messages.push({ role: 'assistant', content });
    }
  }

  // Avoid duplicating the current userMessage if the caller already appended it to conversationHistory.
  const last = recentHistory?.[recentHistory.length - 1];
  const alreadyInHistory = last?.role === 'user' && last?.content === userMessage;
  if (!alreadyInHistory) {
  messages.push({
    role: 'user',
      content: userMessage
  });
  }

  const result = await generateText({
    model: anthropic('claude-opus-4-5-20251101'),
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
