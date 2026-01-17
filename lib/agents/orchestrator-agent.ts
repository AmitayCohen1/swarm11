import Anthropic from '@anthropic-ai/sdk';
import { generateObject } from 'ai';
import { anthropic as aiAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { createResearchTool, ResearchTool, ResearchToolOutput } from '@/lib/tools/research-tool';

/**
 * Orchestrator Agent - Main agent that decides when to use the research tool
 *
 * This agent can:
 * 1. Respond to casual conversation directly
 * 2. Ask clarifying questions before research
 * 3. Invoke the research tool for complex questions
 * 4. Present research findings to the user
 */

// Decision schema for orchestrator
const OrchestratorDecisionSchema = z.object({
  action: z.enum(['respond', 'research', 'clarify']).describe(
    'respond = answer directly without research, research = use research tool, clarify = ask user for more info'
  ),
  reasoning: z.string().describe('Why you chose this action'),
  content: z.string().describe('If respond: your response. If clarify: your question. If research: the research objective to pass to the tool'),
  needsContext: z.boolean().optional().describe('If research: whether you need more context before researching')
});

export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;

// Schema for presenting research results to user
const ResearchPresentationSchema = z.object({
  userMessage: z.string().describe('Friendly message presenting the research findings to the user in markdown'),
  shouldOfferFollowUp: z.boolean().describe('Whether to offer follow-up research'),
  followUpSuggestions: z.array(z.string()).optional().describe('Suggested follow-up questions if applicable')
});

export type ResearchPresentation = z.infer<typeof ResearchPresentationSchema>;

export interface OrchestratorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OrchestratorState {
  conversationHistory: OrchestratorMessage[];
  currentDocument?: string; // Optional: accumulated knowledge
  lastResearchResult?: ResearchToolOutput;
}

export interface OrchestratorResult {
  action: 'respond' | 'research' | 'clarify';
  message: string; // Message to show to user
  researchResult?: ResearchToolOutput; // If action was research
  creditsUsed: number;
  state: OrchestratorState;
}

export class OrchestratorAgent {
  private anthropic: Anthropic;
  private researchTool: ResearchTool;

  constructor(anthropicApiKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.researchTool = createResearchTool();
  }

  /**
   * Main orchestration function
   */
  async process(
    userMessage: string,
    state: OrchestratorState
  ): Promise<OrchestratorResult> {
    // Add user message to history
    const updatedHistory: OrchestratorMessage[] = [
      ...state.conversationHistory,
      { role: 'user', content: userMessage }
    ];

    // Step 1: Decide what to do with this message
    const decision = await this.makeDecision(userMessage, state);

    let creditsUsed = 20; // Base cost for decision making
    let researchResult: ResearchToolOutput | undefined;
    let message: string;

    // Step 2: Execute the decision
    switch (decision.action) {
      case 'respond':
        // Direct response without research
        message = decision.content;
        break;

      case 'clarify':
        // Ask for clarification
        message = decision.content;
        break;

      case 'research':
        // Use the research tool
        const context = this.buildContext(state);
        researchResult = await this.researchTool.execute({
          objective: decision.content,
          context
        });

        creditsUsed += researchResult.creditsUsed;

        // Present research findings to user
        const presentation = await this.presentResearch(researchResult);
        message = presentation.userMessage;

        // Optionally add follow-up suggestions
        if (presentation.shouldOfferFollowUp && presentation.followUpSuggestions) {
          message += '\n\n**Follow-up suggestions:**\n' +
            presentation.followUpSuggestions.map(s => `- ${s}`).join('\n');
        }
        break;
    }

    // Add assistant response to history
    updatedHistory.push({ role: 'assistant', content: message });

    return {
      action: decision.action,
      message,
      researchResult,
      creditsUsed,
      state: {
        conversationHistory: updatedHistory,
        currentDocument: state.currentDocument,
        lastResearchResult: researchResult || state.lastResearchResult
      }
    };
  }

  /**
   * Decide what action to take for this user message
   */
  private async makeDecision(
    userMessage: string,
    state: OrchestratorState
  ): Promise<OrchestratorDecision> {
    const conversationContext = state.conversationHistory
      .slice(-5) // Last 5 messages for context
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `You are an intelligent orchestrator agent that decides how to best help the user.

You have access to a powerful research tool that can:
- Generate focused research questions
- Execute them using Perplexity AI
- Synthesize comprehensive findings

Decide which action to take:

1. **respond** - Answer directly if:
   - It's a simple question you can answer confidently
   - It's casual conversation
   - It's a follow-up to previous research
   - No external research is needed

2. **research** - Use the research tool if:
   - The question requires current information or facts
   - It's a complex topic that benefits from structured research
   - The user explicitly asks for research
   - You need comprehensive, cited information

3. **clarify** - Ask for more information if:
   - The user's request is vague or ambiguous
   - You need more context to provide a good answer
   - Multiple interpretations are possible

Recent conversation:
${conversationContext}

Current user message: ${userMessage}

Make your decision and provide clear reasoning.`;

    const { object } = await generateObject({
      model: aiAnthropic('claude-sonnet-4-20250514'),
      schema: OrchestratorDecisionSchema,
      prompt: systemPrompt
    });

    return object;
  }

  /**
   * Present research results to the user in a friendly way
   */
  private async presentResearch(
    researchResult: ResearchToolOutput
  ): Promise<ResearchPresentation> {
    const questionsText = researchResult.questions
      .map(q => `- ${q.question}`)
      .join('\n');

    const findingsText = researchResult.structuredResult.keyFindings
      .map(f => `- ${f}`)
      .join('\n');

    const sourcesText = researchResult.structuredResult.sources
      .slice(0, 10) // Max 10 sources
      .map((s, idx) => `[${idx + 1}] [${s.title}](${s.url})`)
      .join('\n');

    const prompt = `You are presenting research findings to a user. Create a friendly, informative message that:

1. Summarizes the key findings
2. Provides the detailed summary
3. Lists sources
4. Offers follow-up suggestions if appropriate

Research Questions Investigated:
${questionsText}

Key Findings:
${findingsText}

Detailed Summary:
${researchResult.structuredResult.summary}

Sources:
${sourcesText}

Confidence Level: ${researchResult.structuredResult.confidenceLevel}

Create an engaging presentation that's easy to read and informative.`;

    const { object } = await generateObject({
      model: aiAnthropic('claude-sonnet-4-20250514'),
      schema: ResearchPresentationSchema,
      prompt
    });

    return object;
  }

  /**
   * Build context string from conversation state
   */
  private buildContext(state: OrchestratorState): string {
    const recentMessages = state.conversationHistory
      .slice(-3)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    let context = `Recent conversation:\n${recentMessages}`;

    if (state.lastResearchResult) {
      context += `\n\nPrevious research summary:\n${state.lastResearchResult.structuredResult.summary}`;
    }

    return context;
  }
}

/**
 * Factory function to create orchestrator agent
 */
export function createOrchestratorAgent(): OrchestratorAgent {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }

  return new OrchestratorAgent(anthropicApiKey);
}

/**
 * Helper function to create initial state
 */
export function createInitialState(): OrchestratorState {
  return {
    conversationHistory: [],
    currentDocument: undefined,
    lastResearchResult: undefined
  };
}
