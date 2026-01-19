import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export interface ResearchBrief {
  objective: string;
  targetProfile: string;
  signalTypes: string[];
  exclusionCriteria: string[];
  stoppingConditions: string;
  successCriteria: string;
}

export interface OrchestratorDecision {
  type: 'text_response' | 'single_select' | 'start_research';
  message: string;
  reasoning: string;
  // single_select (required)
  blockedField?: 'objective' | 'targetProfile' | 'signalTypes' | 'successCriteria';
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
      decision: z.enum(['text_response', 'single_select', 'start_research']).describe(
        'text_response: For greetings, capability questions, or non-research requests. ' +
        'single_select: Present 2-4 options for user to pick. Use only when a constraint is required. ' +
        'start_research: Default. Use when you can proceed with reasonable assumptions.'
      ),
      message: z.string().describe('Your response or question text.'),

      // single_select fields (required when decision=single_select)
      blockedField: z.enum(['objective', 'targetProfile', 'signalTypes', 'successCriteria'])
        .optional()
        .describe('For single_select: which research brief field is blocked'),
      options: z.array(z.object({
        label: z.string().describe('2-4 word option')
      })).min(2).max(4).optional().describe('REQUIRED for single_select: 2-4 concrete options'),

      // start_research fields
      researchBrief: z.object({
        objective: z.string().describe('The core research question - what decision is the user trying to make?'),
        targetProfile: z.string().describe('Who or what we are looking for - the hypothesis to validate.'),
        signalTypes: z.array(z.string()).describe('Real-world signals to prioritize (e.g., "social engagement", "recent job changes", "public writing", "hiring activity", "funding announcements")'),
        exclusionCriteria: z.array(z.string()).describe('What to filter out (e.g., "just raised funding", "recently changed jobs", "inactive social presence")'),
        stoppingConditions: z.string().describe('When research is "good enough" (e.g., "3-5 qualified candidates with contact paths", "clear market leader identified")'),
        successCriteria: z.string().describe('What a good answer enables the user to DO (e.g., "send personalized outreach to top 3 candidates")')
      }).optional().describe('Required for start_research. The structured brief for the research agent.'),

      reasoning: z.string().describe('Brief reasoning for your decision')
    }),
    execute: async (params: any) => params
  };

  const systemPrompt = `
You are the Orchestrator Agent.

Your job is to turn a vague user request into a concrete research action with minimal back-and-forth.

INTENT GATE (FIRST CHECK):
This agent is ONLY for research, discovery, evaluation, or scouting tasks.
If the user is asking for:
- explanation or education
- creative generation
- execution of a known task
respond directly instead of running an orchestration flow.

FIRST PRINCIPLES:
- You own research design. Do not ask the user to design it.
- Defaults are better than questions. If a reasonable default exists, use it.
- The only valid reason to ask a question is to apply a constraint the user explicitly cares about.

OPERATING RULES:
1. Infer the user's intent and expected research output silently.
2. If you can proceed with reasonable assumptions, start research immediately.
3. Ask AT MOST one question before starting research.
4. Only ask about constraints that materially narrow scope (e.g. segment, role, geography, priority).
5. Never ask about signals, methods, strategy, hypotheticals, or internal reasoning.
6. If the user's answer is vague, proceed anyway and state assumptions in your reasoning.

DECISION MODES:
- start_research: Default. Use whenever you can act with reasonable assumptions.
- ask_clarification: Use only when a required constraint is missing.
- chat_response: Use only for greetings, capability questions, or non-research requests.

RESEARCH BRIEF REQUIREMENTS (for start_research):
- objective: What decision the research supports
- targetProfile: Who or what is being sought or evaluated
- signalTypes: Signals YOU choose to use
- exclusionCriteria: Filters YOU apply
- stoppingConditions: When confidence is sufficient
- successCriteria: The concrete research output produced

CONSTRAINTS:
- Do not ask more than one question.
- Do not ask the user to choose signals, evidence, or methods.
- Do not ask strategic or hypothetical questions.
- Do not delay action to gather context you can reasonably assume.
- Maximum 2 clarification turns total, then proceed with assumptions.

CONVERSATION HISTORY:
${conversationHistory.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

${brain ? `\nPREVIOUS RESEARCH:\n${brain.substring(0, 1000)}...` : ''}
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
      blockedField: args.blockedField,
      options: args.options,
      researchBrief: args.researchBrief
    };
  }

  // Fallback: ask for clarification
  return {
    type: 'ask_clarification',
    message: 'I want to help you find actionable results. Could you tell me more about what decision you\'re trying to make?',
    reasoning: 'Fallback - insufficient context'
  };
}
