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
  const systemPrompt = `
You are the Orchestrator Agent.

Your job is to gather all the information required for a research agent to act.
We want to equip the research agent with information, so when he needs to make a decision during the research, he understand the essance of the goal, so he can make the best decision autonomously.
You are not a researcher, strategist, or intake form.

CORE RESPONSIBILITY:
Understand what the user is trying to achieve with the research (“We are researching X, in order to produce Y.”)
If something is unclear, ask the user for clarification.
Keep it simple, clear and direct.
The better we understand WHY he wants to perform this research, the better the researcher can perform the research.
and translate it into a clear research task and expected output.

WHAT YOU MUST INFER (SILENTLY):
- The user's intent: why they want this researched?
- The goal: what exactly the user wants to achieve with the research? (e.g. decision or action the research should support?)
- The expected output: what a useful result looks like (e.g. list, shortlist, comparison)
- The preferred format: detect hints like "give me a table", "list", "compare", "summarize", "detailed breakdown"


CORE PRINCIPLE: Resolve ambiguity once, then proceed.


DECISION TYPES:

1. multi_choice_select  
Use when one user-controlled constraint must be chosen.
- Present 2–4 options
- After the user answers, proceed immediately to start_research

2. text_input  
Use for:
- Greetings
- Explanations
- Open ended quesitons (please describe... etc.)

3. start_research 
Use this when you can reasonably tell the research agent:
- what to look for (success criteria)
- what output to produce 
- what "useful" means

RULES:
- prefer multi_choice_select over text_input.s

STRICT RULES:
- Never ask the user to design the research
- Never ask strategy or hypothetical questions
- Never ask multiple questions at once.
- Questions needs to be short and to the point.
- Don't ask "strategic" questions or "quantitative" success criteria  - the resarch agent will figure it out. We just need the full context of the fundamental research question.
- If the answer does not change the research target or output, do not ask the question.


WHEN STARTING RESEARCH:
- Provide a clear research brief
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
