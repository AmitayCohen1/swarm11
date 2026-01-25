import { generateText, Output, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { search } from '../tools/perplexity-search';

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

const DecisionSchema = z.object({
  decision: z.enum(['text_input', 'multi_choice_select', 'start_research']),
  message: z.string(),
  reason: z.string().optional(),
  options: z.array(z.object({
    label: z.string()
  })).optional(),
  objective: z.string().optional(),
  successCriteria: z.array(z.string()).optional(),
  reasoning: z.string()
});

const INTAKE_INSTRUCTIONS = `You are the research intake agent.
You are the first step user will take when he wants to research something. After talking to you, the research agent will start researching.
Your job is to ensure the research agent have enough information to perform the research and provide relevant results.

Specifically, the research agent needs to know:
- What he needs to research?
- What the user expects to get from the research?
- Any valuable information that could understand the problem better and support the research?
- Make sure the research agent wont get confused, ask clarifying questions if needed.

You have access to:
- search: Quick web lookup to understand unfamiliar companies, products, or terms

Rules:
- Use multi_choice_select if you want the user to select one of the options.
- Use text_input if you fundamentally don't understand something and want a longer response from the user.
- Use search when user mentions something unfamiliar (company, product, term) - look it up first
- Dont ask questions that can be resolved during the research
- Once you have enough information to start the research, use start_research
- Keep responses short, concise, and to the point.
- In every response - ask a single spesific question.

Output format:
- decision: "text_input", "multi_choice_select", or "start_research"
- message: your response text (no markdown)
- reason: why you need this info (optional, shown to user)
- options: array of {label: string} when decision is multi_choice_select
- objective: research objective string when decision is start_research
- successCriteria: array of success criteria strings when decision is start_research
- reasoning: your internal reasoning`;

/**
 * Intake Agent - generateText with tools + structured output
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string,
  onProgress?: (update: { type: string; query?: string; answer?: string }) => void
): Promise<OrchestratorDecision> {

  // Build simple messages array
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of conversationHistory) {
    if (m.role === 'user' && m.content) {
      messages.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant' && m.content) {
      messages.push({ role: 'assistant', content: m.content });
    }
  }

  // Add current message if not already there
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  if (!(lastMsg?.role === 'user' && lastMsg?.content === userMessage)) {
    messages.push({ role: 'user', content: userMessage });
  }

  console.log('[Intake] Messages count:', messages.length);

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: INTAKE_INSTRUCTIONS,
    messages,
    tools: { search },
    stopWhen: stepCountIs(3), // Allow up to 3 steps (search → search → respond)
    output: Output.object({ schema: DecisionSchema }),
    onStepFinish: (step: any) => {
      for (const tc of step.toolCalls || []) {
        if (tc.toolName === 'search') {
          const query = tc.args?.queries?.[0]?.query || '';
          console.log('[Intake] Searching:', query);
          onProgress?.({ type: 'intake_searching', query });
        }
      }
      for (const tr of step.toolResults || []) {
        if (tr.toolName === 'search') {
          const answer = tr.result?.results?.[0]?.answer || '';
          console.log('[Intake] Search complete');
          onProgress?.({ type: 'intake_search_complete', query: '', answer });
        }
      }
    }
  });

  const output = result.output;
  console.log('[Intake] Decision:', output?.decision);

  if (!output) {
    return {
      type: 'text_input',
      message: 'What would you like me to research?',
      reasoning: 'No output generated'
    };
  }

  // Build researchBrief from flat fields
  const researchBrief = output.objective ? {
    objective: output.objective,
    successCriteria: output.successCriteria || []
  } : undefined;

  return {
    type: output.decision,
    message: output.message,
    reasoning: output.reasoning,
    reason: output.reason,
    options: output.options,
    researchBrief
  };
}
