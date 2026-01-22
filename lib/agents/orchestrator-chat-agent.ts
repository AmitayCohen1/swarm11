import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { parseResearchMemory, formatForOrchestrator } from '@/lib/utils/research-memory';

export interface ResearchBrief {
  objective: string;
  stoppingConditions: string;
  successCriteria: string;
  outputFormat?: string; // e.g., "table", "bullet list", "comparison", "summary"
}

export interface OrchestratorDecision {
  type: 'text_input' | 'multi_choice_select' | 'start_research';
  message: string;
  reasoning: string;
  // multi_choice_select & text_input (when asking)
  reason?: string; // Why this question is being asked - shown to user
  blockedField?: 'objective' | 'successCriteria';
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
      reason: z.string().optional().describe('REQUIRED when using text_input or multi_choice_select. Brief explanation of WHY you need this info to proceed. Shown to user. For multi_choice_select, reason is shown to user as the options.'),
      blockedField: z.enum(['objective', 'successCriteria'])
        .optional()
        .describe('For multi_choice_select: which research brief field is blocked'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word option')
      })).min(2).max(4).optional().describe('REQUIRED for multi_choice_select: 2-4 concrete options'),

      // start_research fields
      researchBrief: z.object({
        objective: z.string().describe('The core research question - what decision is the user trying to make?'),
        stoppingConditions: z.string().describe('When research is "good enough" (e.g., "3-5 qualified candidates", "clear market leader identified")'),
        successCriteria: z.string().describe('What a good answer enables the user to DO (e.g., "send personalized outreach to top 3 candidates")'),
        outputFormat: z.string().optional().describe('Preferred format for the final answer. Infer from user request: "table"/"comparison table" for comparisons, "bullet list" for lists, "summary" for overviews, "detailed" for in-depth analysis. If not specified, leave empty.')
      }).optional().describe('Required for start_research. The structured brief for the research agent.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `You are the Research Assistant Agent.
  Your role is to ensure there is sufficient clarity about what the user wants researched and why.
  Once this context is clear, you pass it to the Research Agent, who will conduct the research autonomously and effectively.
  You turn vague intent into a clear research brief.
  
  Make sure you understand:
  1. What exactly do we want to research?
  2. Why the user wants this research? What is he planning to do with the result of the research?
  3. What a useful output looks like? How does successful output of this research look like?
  
  
  DECISION TYPES:
  1. multi_choice_select  
  Use when a single constraint must be chosen. Good to reslove a fork in the conversation.
  - Present 2–4 options
  - After selection, proceed immediately to start_research
  
  2. text_input  
  Use only for:
  - Greetings
  - Open-ended clarification when options are insufficient.
  
  3. start_research  
  Use when you can clearly specify:
  - The research goal
  - What the researcher should look for
  - What “useful output” means
  
  RULES:
  - Ask only one question at a time
  - Keep your questions very short and specific and to the point. 
  - use multi_choice_select if possible. If not, use text_input.
  
  WHEN STARTING RESEARCH:
  - Provide a concise and specific research brief. Communicate what the user told you.
  - Make the goal and expected output explicit
  - Optimize for action, not completeness
  
  CONVERSATION HISTORY:
  ${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}
  
  ${brain ? `\nPREVIOUS RESEARCH:\n${formatForOrchestrator(parseResearchMemory(brain), 1500)}` : ''}
  `;
  
  

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    prompt: `User message: "${userMessage}"

Analyze this message. If you can construct a complete research brief, do so. If you need clarification to define success criteria, ask ONE focused question.`,
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
      blockedField: args.blockedField,
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
