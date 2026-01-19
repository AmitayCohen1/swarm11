import { ToolLoopAgent, Output, stepCountIs, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { search } from '@/lib/tools/tavily-search';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ResearchBrief } from './orchestrator-chat-agent';
// import { deductCredits } from '@/lib/credits'; // POC: Disabled for free usage

// Schema for structured research output
const ResearchOutputSchema = z.object({
  confidenceLevel: z.enum(['low', 'medium', 'high']).describe('Confidence in the completeness of findings'),
  finalAnswer: z.string().describe('Complete answer, concise and actionable')
});

interface ResearchExecutorConfig {
  chatSessionId: string;
  userId: string;
  researchBrief: ResearchBrief;
  conversationHistory?: any[];
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

/**
 * Research Executor Agent - Uses ToolLoopAgent for multi-step autonomous research
 * Receives a structured ResearchBrief from the Orchestrator
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    userId,
    researchBrief,
    conversationHistory = [],
    onProgress,
    abortSignal
  } = config;

  let totalCreditsUsed = 0;
  const MAX_STEPS = 100;
  let stepCounter = 0;


  const askUserTool = tool({
    description: 'Ask the user a question with selectable options. Use this to clarify goals, narrow focus, or get decisions.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask'),
      options: z.array(z.object({
        label: z.string().describe('Short label for the option (2-5 words)'),
        description: z.string().optional().describe('Optional longer description')
      })).min(2).max(5).describe('2-5 options for the user to choose from')
    }),
    execute: async ({ question, options }) => {
      onProgress?.({
        type: 'ask_user',
        question,
        options
      });

      return {
        acknowledged: true,
        note: 'Question sent with options. Wait for user selection before continuing.'
      };
    }
  });

  const reflectionTool = tool({
    description: 'MANDATORY after every search batch. Synthesize results, update hypotheses, decide next action.',
    inputSchema: z.object({
      materialChange: z.string().describe('What materially changed in your understanding from this batch?'),
      hypotheses: z.string().describe('Which hypotheses were strengthened, weakened, or discarded?'),
      keyFindings: z.string().describe('Concrete discoveries: names, companies, numbers, contacts (be specific)'),
      nextMove: z.enum(['narrow', 'pivot', 'stop']).describe('narrow: focus on strongest signals. pivot: change direction. stop: sufficient confidence reached.'),
      nextAction: z.string().describe('If not stopping, what specific queries will you run next and why?')
    }),
    execute: async ({ materialChange, hypotheses, keyFindings, nextMove, nextAction }) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Send synthesis to UI
      onProgress?.({
        type: 'agent_thinking',
        materialChange,
        hypotheses,
        nextAction
      });

      // Save detailed findings to brain (internal only, never shown raw to user)
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';

      if (!currentBrain.trim()) {
        currentBrain = `# ${researchBrief.objective}\n\n`;
      }

      // Brain stores findings only - no internal markers
      const reflection = `---\n**[${timestamp}]** ${keyFindings}\n\n`;
      const updatedBrain = currentBrain + reflection;

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({ type: 'brain_update', brain: updatedBrain });

      // Signal completion to stop the loop
      if (nextMove === 'stop') {
        return {
          acknowledged: true,
          direction: nextMove,
          shouldStop: true
        };
      }

      return { acknowledged: true, direction: nextMove };
    }
  });

  const tools = {
    search,
    reflect: reflectionTool,
    askUser: askUserTool
  };

  // Build structured instructions from the research brief
  const instructions = `
You are an Autonomous Research Agent operating in an iterative reasoning loop.
Your objective is to reduce uncertainty for the research brief by discovering, validating, and synthesizing high-signal evidence.

═══════════════════════════════════════════════════════════════
RESEARCH BRIEF FROM ORCHESTRATOR
═══════════════════════════════════════════════════════════════

OBJECTIVE:
${researchBrief.objective}

STOPPING CONDITIONS:
${researchBrief.stoppingConditions}

SUCCESS CRITERIA:
${researchBrief.successCriteria}

═══════════════════════════════════════════════════════════════
OPERATING PRINCIPLES
═══════════════════════════════════════════════════════════════

• Optimize for signal density, not information volume
• Prefer observable behavior and external validation over stated claims
• Actively seek disconfirming evidence

═══════════════════════════════════════════════════════════════
RESEARCH LOOP
═══════════════════════════════════════════════════════════════

1. EXPLORE: Begin with broad exploration to identify promising signal directions
2. FILTER: Rapidly discard low-signal material (self-descriptions, repetition, inactivity, unverified claims)
3. NARROW: Progressively focus toward the strongest signals

═══════════════════════════════════════════════════════════════
SEARCH RULES
═══════════════════════════════════════════════════════════════

• PREFER 1 QUERY AT A TIME - this allows you to reason about each result before continuing
• Use 2-3 queries ONLY when exploring multiple independent directions simultaneously
• Maximum 3 parallel queries allowed
• Each query must include a PURPOSE explaining what uncertainty it tests
• WAIT for ALL queries to complete before calling reflect()
• Do NOT call search() again until reflect() is complete

═══════════════════════════════════════════════════════════════
MANDATORY SYNTHESIS (after every batch)
═══════════════════════════════════════════════════════════════

After each batch, you MUST call reflect() with:
• materialChange: What materially changed in your understanding?
• hypotheses: Which hypotheses were strengthened, weakened, or discarded?
• keyFindings: Concrete discoveries (names, companies, numbers, contacts)
• nextMove: narrow | pivot | stop
• nextAction: What specific queries next and why? (if not stopping)

═══════════════════════════════════════════════════════════════
CHANGE & TIMING SIGNALS
═══════════════════════════════════════════════════════════════

• Actively look for momentum, disengagement, transition, or contradiction over time
• Treat recent changes as higher-weight signals

═══════════════════════════════════════════════════════════════
STOPPING CONDITIONS
═══════════════════════════════════════════════════════════════

Stop when:
• Additional queries are unlikely to materially reduce uncertainty, OR
• The brief's confidence threshold has been met

═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════

• Surface only the most meaningful findings
• Explain why each finding matters
• Explicitly flag weak signals, assumptions, and contradictions
• If the brief cannot be satisfied, specify exactly which signal is missing

═══════════════════════════════════════════════════════════════
CONSTRAINTS
═══════════════════════════════════════════════════════════════

• Do NOT rely on titles, credentials, or self-reported claims as primary evidence
• Do NOT optimize for coverage or exhaustiveness
• You are a reasoning agent, not a search engine
• Your success is measured by how clearly a decision can be made from your output

TOOLS:
• search(queries): 1-5 queries run in parallel. Each needs {query, purpose}.
• reflect(...): MANDATORY after every search. Synthesize and decide: narrow | pivot | stop.
• askUser(question, options): Only if genuinely blocked.
`;


  try {
    const agent = new ToolLoopAgent({
      model: openai('gpt-5.1'),
      instructions,
      tools,
      output: Output.object({ schema: ResearchOutputSchema }),
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      onStepFinish: async (step: any) => {
        const { toolCalls, toolResults, usage } = step || {};
        stepCounter += 1;

        const [sessionCheck] = await db
          .select({ status: chatSessions.status })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        if (sessionCheck?.status !== 'researching') {
          throw new Error('Research stopped by user');
        }

        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;

        onProgress?.({
          type: 'research_iteration',
          iteration: stepCounter,
          creditsUsed: totalCreditsUsed,
          tokensUsed: usage?.totalTokens || 0
        });

        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            const input = (toolCall as any).input;

            if (toolName === 'search') {
              const queries = input?.queries || [];
              onProgress?.({
                type: 'search_started',
                count: queries.length,
                queries: queries.map((q: any) => ({ query: q.query, purpose: q.purpose }))
              });
            }
          }
        }

        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            const toolResult = (result as any).output;

            if (toolName === 'search') {
              // Emit results for each query
              const searchResults = toolResult?.results || [];
              for (const sr of searchResults) {
                const sources = (sr.results || []).map((r: any) => ({
                  title: r.title,
                  url: r.url
                }));

                onProgress?.({
                  type: 'search_result',
                  query: sr.query,
                  purpose: sr.purpose,
                  answer: sr.answer || '',
                  sources,
                  status: sr.status
                });
              }
            }
          }
        }
      }
    } as any);

    // Build context from conversation history
    let contextPrompt = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-5); // Last 5 messages for context
      contextPrompt = '\n\nCONVERSATION CONTEXT:\n';
      recentMessages.forEach((msg: any) => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      contextPrompt += '\n';
    }

    const result = await agent.generate({
      prompt: `${contextPrompt}Execute the research brief above.

CRITICAL: Use FULL natural language questions.
✅ Good: "What are the most popular finance podcasts in 2024?"
❌ Bad: "finance podcasts 2024"

Begin with search() using 1 query. Each query needs {query, purpose}. After results, call reflect() to reason about findings before searching again.`
    });

    // Structured output from AI SDK 6 - typed by ResearchOutputSchema
    const output = result.output;

    return {
      completed: true,
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed,
      output // { confidenceLevel, finalAnswer }
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
