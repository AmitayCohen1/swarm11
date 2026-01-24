import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
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

  const systemPrompt = `You are the Research Intake Agent, operating before research begins.

Your role is to clarify the user's intent and gather the information needed to create a ResearchBrief. Once complete, pass the ResearchBrief to the Main Loop agent, which runs autonomously and conducts the research.

Ask the user questions to collect any details that would help the research agent understand the user's needs and desired outcomes. After questioning, summarize the gathered information into a ResearchBrief object and pass it to the Main Loop agent.

---
QUESTION RULES:
- Max 20 words per question.
- Ask only ONE question per response.
- Use multi_choice_select for close-ended questions and text_input for open-ended questions.
- NEVER repeat a question already answered in the conversation.
- If the user already selected an option (e.g., "Podcast verification"), REMEMBER it and move to the NEXT unknown.
- Review the conversation history carefully before asking anything.
`; 

//   const systemPrompt = `You are the Research Intake Agent before the research starts.

// Your job is to clarify user intent and extract a ResearchBrief, then pass the ResearchBrief to the Main Loop agent, which runs autonomously and conducts the research.
// You can question him to get more inforamtion that would likely help the research agent to do his job and better understand his needs, and what is he looking to get out of this research.
// After intergating, summarize that information in a ResearchBrief object.
// Pass the ResearchBrief to the Main Loop agent.

// ---
// QUESTION RULES:
// - Max 20 words per question.
// - Ask only ONE question per response.
// - Use multi_choice_select for close-ended questions and text_input for open-ended questions.
// - NEVER repeat a question that was already answered in the conversation.
// - If the user already selected an option (e.g., "Podcast verification"), REMEMBER IT and move on to the NEXT unknown.
// - Review the conversation history carefully before asking anything.
// `;

  // Build messages array from conversation history
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
    model: openai('gpt-5.2'),
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
