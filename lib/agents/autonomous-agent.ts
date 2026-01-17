import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { perplexityResearch } from '@/lib/tools/perplexity-research';
import { createBrainTool } from '@/lib/tools/brain-tool';
import { completionTool } from '@/lib/tools/completion-tool';
import { createResearchPlan, summarizeFindings } from '@/lib/tools/planning-tool';
import { z } from 'zod';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { deductCredits, hasEnoughCredits } from '@/lib/credits';

interface AgentConfig {
  sessionId: string;
  userId: string;
  objective: string;
  maxIterations: number;
  onProgress?: (update: any) => void;
}

export async function createAndRunAutonomousAgent(config: AgentConfig) {
  const { sessionId, userId, objective, maxIterations, onProgress } = config;

  // Define askClarification tool
  const askClarification = {
    description: 'Ask the user a clarifying question if the objective is unclear, ambiguous, or missing critical information needed to conduct meaningful research. Use this when you genuinely cannot proceed without user input.',
    inputSchema: z.object({
      question: z.string().describe('The specific clarifying question to ask the user'),
      context: z.string().describe('Explain why this clarification is needed and how it will help the research'),
      suggestedAnswers: z.array(z.string()).optional().describe('Provide 2-3 example answers to guide the user')
    }),
    execute: async ({ question, context, suggestedAnswers }: { question: string; context: string; suggestedAnswers?: string[] }) => {
      return {
        needsUserInput: true,
        question,
        context,
        suggestedAnswers: suggestedAnswers || []
      };
    }
  };

  const tools = {
    askClarification,
    createResearchPlan,
    perplexityResearch,
    summarizeFindings,
    updateBrain: createBrainTool(sessionId),
    complete: completionTool
  };

  const systemPrompt = `You are an autonomous research agent. Your objective is:

"${objective}"

═══════════════════════════════════════════════════════════════
STRUCTURED WORKFLOW - Follow these phases in order:
═══════════════════════════════════════════════════════════════

📋 PHASE 1: ANALYSIS & PLANNING (First iteration only)
─────────────────────────────────────────────────────────────
Analyze the objective and decide:

Option A - Objective is VAGUE/UNCLEAR (e.g., "test", "research something"):
→ Call askClarification
   - Explain what's unclear
   - Ask specific question
   - Provide 2-3 example answers

Option B - Objective is CLEAR and SPECIFIC:
→ Call createResearchPlan
   - Define your strategy
   - Generate 3-5 specific research questions
   - Explain your reasoning

🔍 PHASE 2: RESEARCH EXECUTION
─────────────────────────────────────────────────────────────
For each question in your plan:

1. Call perplexityResearch(query="specific question")
2. IMMEDIATELY call updateBrain(findings="...", category="...")
3. Repeat for all questions

MANDATORY: Never call perplexityResearch without updateBrain right after!

📊 PHASE 3: CONSOLIDATION (Optional, after several queries)
─────────────────────────────────────────────────────────────
Call summarizeFindings to:
- Synthesize what you've learned
- Identify key insights
- Spot knowledge gaps
- Plan next steps if needed

✅ PHASE 4: COMPLETION
─────────────────────────────────────────────────────────────
When you have comprehensive information:
→ Call complete(reasoning="...", confidenceLevel="high/medium/low", keyFindings=[...])

═══════════════════════════════════════════════════════════════
EXAMPLES:
═══════════════════════════════════════════════════════════════

Example 1: Vague objective "test"
Iteration 1: askClarification("What would you like me to research?...")

Example 2: Clear objective "Top 3 React state libraries in 2026"
Iteration 1: createResearchPlan(
  strategy="Research current state management landscape",
  questions=[
    "What are the most popular React state management libraries in 2026?",
    "What are the key features and use cases for each?",
    "What do developers say about pros/cons?"
  ]
)
Iteration 2: perplexityResearch("most popular React state...") → updateBrain
Iteration 3: perplexityResearch("Redux vs Zustand features...") → updateBrain
Iteration 4: perplexityResearch("developer opinions...") → updateBrain
Iteration 5: summarizeFindings (optional)
Iteration 6: complete

═══════════════════════════════════════════════════════════════
CRITICAL RULES:
═══════════════════════════════════════════════════════════════
✓ ALWAYS start with askClarification OR createResearchPlan
✓ NEVER jump straight into perplexityResearch
✓ ALWAYS call updateBrain immediately after perplexityResearch
✓ Organize brain with clear categories
✓ Think before acting - be strategic, not reactive`;

  let currentIteration = 0;
  let totalCreditsUsed = 0;
  let shouldStop = false;
  let stopReason: string | null = null;
  let completionData: any = null;

  // Check if there's a pending response from user (resuming after clarification)
  const [sessionState] = await db
    .select({ pendingResponse: autonomousSessions.pendingResponse, pendingQuestion: autonomousSessions.pendingQuestion })
    .from(autonomousSessions)
    .where(eq(autonomousSessions.id, sessionId));

  // Conversation prompt
  let currentPrompt = sessionState?.pendingResponse
    ? `The user has answered your clarification question.

QUESTION YOU ASKED: ${(sessionState.pendingQuestion as any)?.question || 'N/A'}

USER'S ANSWER: ${sessionState.pendingResponse}

Now proceed with creating a research plan based on this clarification, then execute your research.`
    : `FIRST ITERATION: Analyze the objective and decide your approach.

Is the objective clear and specific?
- If NO (vague/unclear): Call askClarification
- If YES (clear and specific): Call createResearchPlan

Objective: "${objective}"

What's your decision?`;

  // Clear pending response if it exists (we've used it)
  if (sessionState?.pendingResponse) {
    await db
      .update(autonomousSessions)
      .set({
        pendingResponse: null,
        pendingQuestion: null
      })
      .where(eq(autonomousSessions.id, sessionId));
  }

  try {
    // Multi-step autonomous loop
    while (currentIteration < maxIterations && !shouldStop) {
      currentIteration++;

      // Check credits before iteration
      const estimatedCost = 100;
      const canContinue = await hasEnoughCredits(userId, estimatedCost);

      if (!canContinue) {
        stopReason = 'insufficient_credits';
        break;
      }

      // Check if session was stopped by user
      const [session] = await db
        .select({ status: autonomousSessions.status })
        .from(autonomousSessions)
        .where(eq(autonomousSessions.id, sessionId));

      if (session?.status === 'stopped') {
        stopReason = 'user_stopped';
        break;
      }

      // Run agent step with maxSteps to allow tool execution
      const result = await generateText({
        model: anthropic('claude-sonnet-4-20250514'),
        system: systemPrompt,
        prompt: currentPrompt,
        tools,
        temperature: 0.3
      });

      // Calculate credits for this step
      const creditsUsed = Math.ceil((result.usage.totalTokens || 0) / 1000);
      totalCreditsUsed += creditsUsed;

      // Deduct credits
      await deductCredits(userId, creditsUsed);

      // Update session in database
      await db
        .update(autonomousSessions)
        .set({
          iterationCount: currentIteration,
          creditsUsed: sql`${autonomousSessions.creditsUsed} + ${creditsUsed}`,
          lastReasoning: {
            text: result.text?.substring(0, 500),
            tokens: result.usage.totalTokens
          },
          updatedAt: new Date()
        })
        .where(eq(autonomousSessions.id, sessionId));

      // Extract tool calls for progress update
      const toolCalls = result.toolCalls?.map((tc: any) => ({
        tool: tc.toolName,
        input: tc.args || tc.input
      })) || [];

      // Emit progress event
      onProgress?.({
        type: 'step_complete',
        iteration: currentIteration,
        text: result.text?.substring(0, 200),
        toolCalls,
        creditsUsed,
        tokensUsed: result.usage.totalTokens
      });

      // Check if agent called complete tool or asked for clarification
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls as any[]) {
          if (toolCall.toolName === 'complete') {
            shouldStop = true;
            stopReason = 'goal_achieved';
            completionData = toolCall.args || toolCall.input;
            break;
          }

          if (toolCall.toolName === 'askClarification') {
            shouldStop = true;
            stopReason = 'needs_clarification';

            const clarificationData = toolCall.args || toolCall.input;

            // Save the pending question to database
            await db
              .update(autonomousSessions)
              .set({
                status: 'waiting_for_user',
                pendingQuestion: clarificationData,
                updatedAt: new Date()
              })
              .where(eq(autonomousSessions.id, sessionId));

            break;
          }
        }
      }

      // Update prompt for next iteration based on progress
      if (currentIteration === 1) {
        currentPrompt = 'Execute your research plan. Start with the first research query, then immediately save findings to the brain.';
      } else {
        currentPrompt = 'Continue executing your research plan. Remember: perplexityResearch → updateBrain for each question.';
      }
    }

    // Determine final stop reason
    if (!stopReason) {
      stopReason = currentIteration >= maxIterations ? 'max_queries' : 'unknown';
    }

    // If agent needs clarification, return early without generating report
    if (stopReason === 'needs_clarification') {
      return {
        success: true,
        needsClarification: true,
        stopReason,
        totalSteps: currentIteration,
        creditsUsed: totalCreditsUsed
      };
    }

    // Get final brain state
    const [finalSession] = await db
      .select({ brain: autonomousSessions.brain, creditsUsed: autonomousSessions.creditsUsed })
      .from(autonomousSessions)
      .where(eq(autonomousSessions.id, sessionId));

    // Generate final report
    const finalReport = await generateFinalReport(
      objective,
      finalSession?.brain || '',
      completionData
    );

    // Update session as completed
    await db
      .update(autonomousSessions)
      .set({
        status: 'completed',
        finalReport,
        stopReason,
        completedAt: new Date()
      })
      .where(eq(autonomousSessions.id, sessionId));

    return {
      success: true,
      finalReport,
      stopReason,
      totalSteps: currentIteration,
      creditsUsed: totalCreditsUsed
    };

  } catch (error: any) {
    // Mark session as failed
    await db
      .update(autonomousSessions)
      .set({
        status: 'failed',
        stopReason: 'error'
      })
      .where(eq(autonomousSessions.id, sessionId));

    throw error;
  }
}

async function generateFinalReport(
  objective: string,
  brain: string,
  completionData: any
): Promise<string> {
  const { generateText } = await import('ai');
  const { anthropic } = await import('@ai-sdk/anthropic');

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    prompt: `Create a comprehensive final research report.

OBJECTIVE:
${objective}

ACCUMULATED KNOWLEDGE (BRAIN):
${brain}

${completionData ? `
COMPLETION SUMMARY:
- Confidence: ${completionData.confidenceLevel}
- Reasoning: ${completionData.reasoning}
- Key Findings: ${completionData.keyFindings?.join(', ') || 'N/A'}
` : ''}

Generate a well-structured markdown report with:
1. Executive Summary
2. Key Findings (organized by theme)
3. Detailed Analysis
4. Sources/Citations (if available)
5. Confidence Assessment
6. Recommendations or Next Steps

Format in clean, professional markdown.`,
    temperature: 0.4
  });

  return text;
}
