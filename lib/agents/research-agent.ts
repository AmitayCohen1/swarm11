/**
 * Research Agent - Version 8 (Simplified)
 *
 * Clean search → reflect loop. Messages ARE the knowledge.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search } from '@/lib/tools/tavily-search';
import { tool } from 'ai';

interface ResearchAgentConfig {
  objective: string;
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ResearchAgentResult {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  queriesExecuted: string[];
  creditsUsed: number;
  done: boolean;
  summary?: string;
}

/**
 * Simple research agent - search and reflect in a loop
 */
export async function executeResearchCycle(config: ResearchAgentConfig): Promise<ResearchAgentResult> {
  const {
    objective,
    maxIterations = 15,
    abortSignal,
    onProgress
  } = config;

  const model = openai('gpt-4.1');
  let creditsUsed = 0;
  const queriesExecuted: string[] = [];

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  // Tool: Signal done with summary
  const doneTool = tool({
    description: 'Call when you have enough information to answer the research objective. Provide a comprehensive summary of everything learned.',
    inputSchema: z.object({
      summary: z.string().describe('Comprehensive summary of all findings that answers the research objective'),
      confidence: z.enum(['high', 'medium', 'low']).describe('How confident you are in the answer'),
    }),
    execute: async ({ summary, confidence }) => {
      onProgress?.({ type: 'research_done', summary, confidence });
      return { done: true, summary, confidence };
    }
  });

  const systemPrompt = `You are a research agent. Your job is to search for information and build understanding through reflection.

OBJECTIVE: ${objective}

WORKFLOW:
1. Search for information (one focused query at a time)
2. After each search, reflect on what you learned in your response
3. Decide what to search next based on gaps in your knowledge
4. When you have enough information, call 'done' with a comprehensive summary

REFLECTION FORMAT (after each search):
- Learned: [Key facts discovered]
- Still need: [What's missing to fully answer the objective]
- Next: [What to search for next, or call done if complete]

RULES:
- One search query at a time
- Reflect after every search - your reflections build the knowledge base
- Don't repeat searches - vary your queries
- Call 'done' when you can confidently answer the objective`;

  onProgress?.({ type: 'research_started', objective });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  messages.push({
    role: 'user',
    content: `Research this objective: ${objective}\n\nStart by searching for the most important information first.`
  });

  let done = false;
  let summary: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        search,
        done: doneTool,
      },
      abortSignal
    });

    trackUsage(result.usage);

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        const queries = tc.input?.queries || tc.args?.queries || [];
        onProgress?.({ type: 'search_started', queries });

        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searchResults = toolOutput.results || [];

        for (const sr of searchResults) {
          queriesExecuted.push(sr.query);
        }

        onProgress?.({
          type: 'search_completed',
          count: searchResults.length,
          queries: searchResults.map((sr: any) => ({
            query: sr.query,
            answer: sr.answer,
            sources: sr.results?.map((r: any) => ({ url: r.url, title: r.title })) || []
          }))
        });
      }

      if (tc.toolName === 'done') {
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const doneResult = (toolResult as any)?.output || (toolResult as any)?.result || {};
        done = true;
        summary = doneResult.summary;
      }
    }

    // Add assistant's reflection to messages
    if (result.text) {
      messages.push({
        role: 'assistant',
        content: result.text
      });
      onProgress?.({ type: 'reflection', content: result.text });
    }

    if (done) {
      break;
    }

    // Prompt to continue
    messages.push({
      role: 'user',
      content: 'Continue researching. What do you still need to find out?'
    });
  }

  onProgress?.({
    type: 'research_cycle_completed',
    queriesExecuted: queriesExecuted.length,
    done
  });

  return {
    messages,
    queriesExecuted,
    creditsUsed,
    done,
    summary
  };
}
