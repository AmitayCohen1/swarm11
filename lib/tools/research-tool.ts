import Anthropic from '@anthropic-ai/sdk';
import { generateObject } from 'ai';
import { anthropic as aiAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

/**
 * Research Tool - A dedicated agent that generates research questions and executes them
 * This tool can be invoked by a main orchestrator agent
 */

// Schema for question generation
const ResearchQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string().describe('A specific, focused research question'),
      reasoning: z.string().describe('Why this question is important for answering the user\'s objective'),
      priority: z.enum(['high', 'medium', 'low']).describe('How critical this question is')
    })
  ).describe('3-5 research questions to investigate'),
  approach: z.string().describe('Overall research strategy and how these questions will be answered')
});

// Schema for structured research result
const ResearchResultSchema = z.object({
  summary: z.string().describe('Comprehensive summary of findings in markdown format'),
  keyFindings: z.array(z.string()).describe('List of 3-7 key findings from the research'),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      relevance: z.string().describe('Why this source is relevant'),
    })
  ),
  confidenceLevel: z.enum(['high', 'medium', 'low']).describe('Confidence in the research findings'),
  suggestedFollowUps: z.array(z.string()).optional().describe('Suggested follow-up research questions if needed')
});

export type ResearchQuestions = z.infer<typeof ResearchQuestionsSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export interface ResearchToolInput {
  objective: string;
  context?: string; // Optional context from the conversation
  maxQuestions?: number; // Max questions to generate (default 5)
}

export interface ResearchToolOutput {
  questions: ResearchQuestions['questions'];
  results: Array<{
    question: string;
    answer: string;
    sources: Array<{ title: string; url: string; snippet: string }>;
  }>;
  structuredResult: ResearchResult;
  creditsUsed: number;
}

export class ResearchTool {
  private anthropic: Anthropic;
  private perplexityApiKey: string;

  constructor(anthropicApiKey: string, perplexityApiKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.perplexityApiKey = perplexityApiKey;
  }

  /**
   * Main entry point: generates research questions and executes them
   */
  async execute(input: ResearchToolInput): Promise<ResearchToolOutput> {
    const { objective, context, maxQuestions = 5 } = input;

    // Step 1: Generate research questions using Claude
    const questions = await this.generateQuestions(objective, context, maxQuestions);

    // Step 2: Execute each question using Perplexity
    const results = await this.executeQuestions(questions.questions);

    // Step 3: Synthesize findings into structured output
    const structuredResult = await this.synthesizeFindings(objective, results);

    // Calculate credits (rough estimate)
    const creditsUsed = 50 + (questions.questions.length * 10) + 100; // Question gen + searches + synthesis

    return {
      questions: questions.questions,
      results,
      structuredResult,
      creditsUsed
    };
  }

  /**
   * Generate research questions using Claude
   */
  private async generateQuestions(
    objective: string,
    context?: string,
    maxQuestions: number = 5
  ): Promise<ResearchQuestions> {
    const prompt = `You are a research planning expert. Given a user's research objective, generate ${maxQuestions} specific, focused research questions that will help comprehensively answer their objective.

User Objective: ${objective}

${context ? `Additional Context: ${context}` : ''}

Generate research questions that:
1. Break down the objective into specific, answerable sub-questions
2. Cover different aspects of the topic
3. Are concrete and specific (not vague)
4. Can be answered through web research

Prioritize questions by importance (high/medium/low).`;

    const { object } = await generateObject({
      model: aiAnthropic('claude-sonnet-4-20250514'),
      schema: ResearchQuestionsSchema,
      prompt
    });

    return object;
  }

  /**
   * Execute research questions using Perplexity AI
   */
  private async executeQuestions(
    questions: ResearchQuestions['questions']
  ): Promise<Array<{
    question: string;
    answer: string;
    sources: Array<{ title: string; url: string; snippet: string }>;
  }>> {
    const results = await Promise.all(
      questions.map(async (q) => {
        try {
          const perplexityResult = await this.searchPerplexity(q.question);
          return {
            question: q.question,
            answer: perplexityResult.answer,
            sources: perplexityResult.sources
          };
        } catch (error) {
          console.error(`Error searching for "${q.question}":`, error);
          return {
            question: q.question,
            answer: 'Unable to retrieve answer due to API error',
            sources: []
          };
        }
      })
    );

    return results;
  }

  /**
   * Call Perplexity API for a single question
   */
  private async searchPerplexity(query: string): Promise<{
    answer: string;
    sources: Array<{ title: string; url: string; snippet: string }>;
  }> {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro', // Use sonar-pro for best research results
        messages: [
          {
            role: 'system',
            content: 'You are a helpful research assistant. Provide accurate, comprehensive answers with citations.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.2,
        max_tokens: 1000,
        return_citations: true,
        search_recency_filter: 'month' // Focus on recent information
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Extract answer and citations
    const answer = data.choices[0]?.message?.content || 'No answer available';
    const citations = data.citations || [];

    // Format sources
    const sources = citations.map((url: string, index: number) => ({
      title: `Source ${index + 1}`,
      url,
      snippet: '' // Perplexity doesn't provide snippets directly
    }));

    return { answer, sources };
  }

  /**
   * Synthesize all research findings into a structured result
   */
  private async synthesizeFindings(
    objective: string,
    results: Array<{
      question: string;
      answer: string;
      sources: Array<{ title: string; url: string; snippet: string }>;
    }>
  ): Promise<ResearchResult> {
    const allFindings = results
      .map(r => `Question: ${r.question}\nAnswer: ${r.answer}`)
      .join('\n\n---\n\n');

    const prompt = `You are a research synthesis expert. Given the user's original objective and the research findings, create a comprehensive structured summary.

Original Objective: ${objective}

Research Findings:
${allFindings}

Create a comprehensive summary that:
1. Directly answers the user's objective
2. Highlights the most important findings
3. Provides confidence level in the findings
4. Suggests follow-up research if needed`;

    const { object } = await generateObject({
      model: aiAnthropic('claude-sonnet-4-20250514'),
      schema: ResearchResultSchema,
      prompt
    });

    // Merge sources from all results
    const allSources = results.flatMap((r, idx) =>
      r.sources.map(s => ({
        title: s.title || `Source from question ${idx + 1}`,
        url: s.url,
        relevance: `Related to: ${r.question}`
      }))
    );

    // Deduplicate sources by URL
    const uniqueSources = Array.from(
      new Map(allSources.map(s => [s.url, s])).values()
    );

    return {
      ...object,
      sources: uniqueSources
    };
  }
}

/**
 * Factory function to create research tool instance
 */
export function createResearchTool(): ResearchTool {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const perplexityApiKey = process.env.PERPLEXITY_API_KEY;

  if (!anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY in environment variables. Please add it to .env.local');
  }

  if (!perplexityApiKey) {
    throw new Error('Missing PERPLEXITY_API_KEY in environment variables. Get your API key from https://www.perplexity.ai/settings/api and add it to .env.local');
  }

  return new ResearchTool(anthropicApiKey, perplexityApiKey);
}
