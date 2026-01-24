/**
 * Brain Agent
 *
 * The strategic thinker that plans and evaluates (but never searches):
 * 1. Generates research questions from the objective
 * 2. Evaluates question results
 * 3. Decides next actions (spawn new questions, synthesize)
 * 4. Writes the final answer
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { BrainDoc, ResearchQuestion } from '@/lib/types/research-question';
import {
  addResearchQuestion,
  addBrainDecision,
  setDocStatus,
  setFinalAnswer,
  formatBrainDocForAgent,
  getResearchQuestionsSummary,
  getCompletedResearchQuestions,
  getRunningResearchQuestions,
  getPendingResearchQuestions,
} from '@/lib/utils/question-operations';

// Logging helper
const log = (fn: string, message: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `[BrainAgent ${timestamp}] [${fn}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
};

interface BrainAgentConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

// ============================================================
// ResearchQuestion Generation
// ============================================================

interface GenerateResearchQuestionsConfig {
  doc: BrainDoc;
  count?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface GenerateResearchQuestionsResult {
  doc: BrainDoc;
  questionIds: string[];
  creditsUsed: number;
}

/**
 * Generate strategy + questions in one coherent thought
 */
export async function generateResearchQuestions(
  config: GenerateResearchQuestionsConfig
): Promise<GenerateResearchQuestionsResult> {
  const { doc: initialDoc, count = 3, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;
  let creditsUsed = 0;
  const questionIds: string[] = [];

  log('generateResearchQuestions', `Generating strategy + ${count} questions for: ${doc.objective}`);

  // Single tool that outputs strategy AND questions together
  const planResearchTool = tool({
    description: 'Plan the research: explain your thinking and create research questions',
    inputSchema: z.object({
      strategy: z.string().describe('Your thinking in natural language: "First I\'ll look at X because... Then I\'ll explore Y to understand... Based on what I find, I\'ll figure out how to continue." (3-5 sentences, conversational, NO numbered lists)'),
      questions: z.array(z.object({
        name: z.string().describe('Tab label (2-4 words). E.g., "Podcast Networks"'),
        question: z.string().describe('Short, precise question (max 15 words). E.g., "Which podcast networks have the biggest advertising budgets?"'),
        description: z.string().describe('Why this matters (1 sentence)'),
        goal: z.string().describe('What success looks like (1 sentence)'),
      })).min(1).max(5).describe(`${count} parallel research questions`),
    }),
    execute: async ({ strategy, questions }) => {
      // Set strategy
      doc = { ...doc, researchStrategy: strategy };

      onProgress?.({
        type: 'brain_strategy',
        strategy,
      });

      // Create questions
      for (const q of questions) {
        doc = addResearchQuestion(doc, q.name, q.question, q.goal, 10, q.description);
        const newQ = doc.questions[doc.questions.length - 1];
        questionIds.push(newQ.id);

        doc = addBrainDecision(doc, 'spawn', `${q.name}: ${q.question}`, newQ.id);

        onProgress?.({
          type: 'question_spawned',
          questionId: newQ.id,
          name: q.name,
          question: q.question,
          description: q.description,
          goal: q.goal,
        });
      }

      return { success: true, questionCount: questions.length };
    }
  });

  const systemPrompt = `You are the Brain, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

Plan your research using the plan_research tool. In ONE call, provide:

1. STRATEGY - Your thinking in natural language:
   - "First I'll look at X because that's where we'll likely find..."
   - "Then I'll dig into Y to understand..."
   - "Based on what I find, I'll figure out whether to go deeper or pivot..."

   Write conversationally, NOT as a numbered list.

2. QUESTIONS - ${count} parallel research angles to explore:
   - Each should be independent (can run in parallel)
   - Each should be specific and answerable via web search
   - Cover different angles of the objective
   - IMPORTANT: Questions must be SHORT (max 15 words). No verbose questions.
   - Good: "Which podcast networks have the biggest advertising budgets?"
   - Bad: "What are the top 20-40 verified concrete outreach targets with contact information..."

Call plan_research with your strategy and questions.`;

  onProgress?.({ type: 'brain_generating_questions', count });

  log('generateResearchQuestions', 'Generating strategy + questions...');

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `Plan your research approach for: ${doc.objective}`,
    tools: { plan_research: planResearchTool },
    toolChoice: { type: 'tool', toolName: 'plan_research' },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  log('generateResearchQuestions', `Generated ${questionIds.length} questions`);

  onProgress?.({
    type: 'brain_questions_generated',
    count: questionIds.length,
    questions: doc.questions.filter(i => questionIds.includes(i.id)).map(i => ({
      id: i.id,
      name: i.name,
      goal: i.goal
    }))
  });

  return { doc, questionIds, creditsUsed };
}

// ============================================================
// Evaluation & Decision Making
// ============================================================

interface EvaluateResearchQuestionsConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

type BrainNextAction =
  | { action: 'spawn_new'; name: string; question: string; description: string; goal: string }
  | { action: 'synthesize' };

interface EvaluateResearchQuestionsResult {
  doc: BrainDoc;
  nextAction: BrainNextAction;
  reasoning: string;
  creditsUsed: number;
}

/**
 * Evaluate completed questions and decide next action
 */
export async function evaluateResearchQuestions(
  config: EvaluateResearchQuestionsConfig
): Promise<EvaluateResearchQuestionsResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;
  let creditsUsed = 0;

  const completed = getCompletedResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const pending = getPendingResearchQuestions(doc);

  // Count total memory entries across all questions
  const totalMemory = doc.questions.reduce((sum, q) => sum + q.memory.length, 0);

  log('evaluateResearchQuestions', 'Evaluating state:', {
    completed: completed.length,
    running: running.length,
    pending: pending.length,
    totalMemory
  });

  const evaluateTool = tool({
    description: 'Evaluate progress and decide what to do next',
    inputSchema: z.object({
      decision: z.enum(['spawn_new', 'synthesize']).describe(
        'spawn_new=need to research something new, synthesize=we have enough, finish research'
      ),
      keyFindings: z.string().describe('2-3 sentence summary of what we learned from completed questions. E.g., "We identified 15 podcast networks including Gimlet and Wondery. Found that most have dedicated ad sales teams..."'),
      gaps: z.string().describe('What information is still missing? E.g., "We still need contact emails and budget ranges for the top 5 networks."'),
      reasoning: z.string().describe('Your decision rationale combining findings and gaps. E.g., "Based on our findings about networks, we now need to dig into their specific contact details..."'),

      // For spawn_new
      newName: z.string().optional().describe('Tab label (2-4 words)'),
      newQuestion: z.string().optional().describe('Short, precise question (max 15 words)'),
      newDescription: z.string().optional().describe('Why this matters (1 sentence)'),
      newGoal: z.string().optional().describe('What success looks like (1 sentence)'),
    }),
    execute: async (params) => params
  });

  const systemPrompt = `You are the Brain, the strategic research orchestrator.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CURRENT STATE:
${formatBrainDocForAgent(doc)}

SUMMARY:
- Completed questions: ${completed.length}
- Running questions: ${running.length}
- Pending questions: ${pending.length}
- Total memory entries: ${totalMemory}

${getResearchQuestionsSummary(doc)}

---

EVALUATE and DECIDE what to do next.

YOUR RESPONSE MUST INCLUDE:
1. KEY FINDINGS - Summarize what we learned (2-3 sentences). Be specific: names, numbers, facts.
   Example: "We identified 15 podcast networks including Gimlet, Wondery, and iHeart. Found that Gimlet was acquired by Spotify for $230M..."

2. GAPS - What's still missing to satisfy success criteria?
   Example: "We still need direct contact emails for ad sales teams and typical budget ranges."

3. REASONING - Your decision based on findings and gaps.
   Example: "We have good coverage of networks but lack actionable contact info. Let's dig into specific contact details..."

OPTIONS:
- SPAWN_NEW: Create a new focused research question (short and precise, max 15 words)
- SYNTHESIZE: We have enough, finish the research

CRITICAL BEHAVIOR:
- This is iterative - can take MANY ROUNDS (10–20+) if needed.
- For EACH success criterion: is it covered or not?
- Only SYNTHESIZE if ALL criteria are covered OR gaps are declared unfindable.
- New questions must be SHORT and SPECIFIC (max 15 words).

`;

  onProgress?.({ type: 'brain_evaluating' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Evaluate the current state and decide the next action.',
    tools: { evaluate: evaluateTool },
    toolChoice: { type: 'tool', toolName: 'evaluate' },
    abortSignal
  });

  creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const params = toolCall?.input || toolCall?.args || { decision: 'synthesize', reasoning: 'Fallback', keyFindings: '', gaps: '' };

  // Build rich reasoning from findings + gaps + reasoning
  const richReasoning = [
    params.keyFindings && `We found: ${params.keyFindings}`,
    params.gaps && `Still needed: ${params.gaps}`,
    params.reasoning
  ].filter(Boolean).join(' ');

  let nextAction: BrainNextAction;

  switch (params.decision) {
    case 'spawn_new':
      nextAction = {
        action: 'spawn_new',
        name: params.newName || '',
        question: params.newQuestion || '',
        description: params.newDescription || '',
        goal: params.newGoal || ''
      };
      doc = addBrainDecision(doc, 'spawn', richReasoning);
      break;

    case 'synthesize':
    default:
      nextAction = { action: 'synthesize' };
      doc = addBrainDecision(doc, 'synthesize', richReasoning);
      doc = setDocStatus(doc, 'synthesizing');
      break;
  }

  onProgress?.({
    type: 'brain_decision',
    decision: params.decision,
    reasoning: richReasoning,
    keyFindings: params.keyFindings,
    gaps: params.gaps,
    nextAction
  });

  return {
    doc,
    nextAction,
    reasoning: richReasoning,
    creditsUsed
  };
}

// ============================================================
// Synthesis
// ============================================================

interface SynthesizeConfig {
  doc: BrainDoc;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface SynthesizeResult {
  doc: BrainDoc;
  finalAnswer: string;
  confidence: 'low' | 'medium' | 'high';
  creditsUsed: number;
}

/**
 * Synthesize final answer from all findings
 */
export async function synthesizeFinalAnswer(
  config: SynthesizeConfig
): Promise<SynthesizeResult> {
  const { doc: initialDoc, abortSignal, onProgress } = config;
  const model = openai('gpt-5.2');
  let doc = initialDoc;

  // Collect all results from memory
  const allResults: { questionName: string; answer: string }[] = [];
  for (const q of doc.questions) {
    for (const m of q.memory) {
      if (m.type === 'result' && m.answer) {
        allResults.push({ questionName: q.name, answer: m.answer });
      }
    }
  }

  log('synthesizeFinalAnswer', 'Starting synthesis with:', {
    objective: doc.objective,
    totalResults: allResults.length,
    questions: doc.questions.length
  });

  const synthesizeTool = tool({
    description: 'Deliver the final synthesized answer',
    inputSchema: z.object({
      confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the answer'),
      finalAnswer: z.string().describe('Complete, well-structured answer to the research objective'),
    }),
    execute: async ({ confidence, finalAnswer }) => ({ confidence, finalAnswer })
  });

  const systemPrompt = `You are synthesizing the final research answer.

OBJECTIVE: ${doc.objective}

SUCCESS CRITERIA:
${doc.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

RESEARCH DOCUMENT:
${formatBrainDocForAgent(doc)}

ALL RESULTS (${allResults.length} total):
${allResults.map(({ questionName, answer }) =>
  `- [${questionName}] ${answer.length > 200 ? answer.slice(0, 200) + '...' : answer}`
).join('\n')}

---

SYNTHESIZE a comprehensive final answer:
1. Address the objective directly
2. Reference the success criteria
3. Organize findings logically
4. Note any gaps or limitations
5. Provide actionable conclusions`;

  onProgress?.({ type: 'brain_synthesizing' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Synthesize your final answer. Use the synthesize tool.',
    tools: { synthesize: synthesizeTool },
    toolChoice: { type: 'tool', toolName: 'synthesize' },
    abortSignal
  });

  const creditsUsed = Math.ceil((result.usage?.totalTokens || 0) / 1000);

  const toolCall = result.toolCalls?.[0] as any;
  const output = toolCall?.input || toolCall?.args || {
    confidence: 'low',
    finalAnswer: 'Research completed but no synthesis extracted.'
  };

  doc = setFinalAnswer(doc, output.finalAnswer);

  onProgress?.({
    type: 'brain_synthesis_complete',
    confidence: output.confidence,
    answerLength: output.finalAnswer.length
  });

  return {
    doc,
    finalAnswer: output.finalAnswer,
    confidence: output.confidence,
    creditsUsed
  };
}
