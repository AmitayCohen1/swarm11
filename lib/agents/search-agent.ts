/**
 * Search Agent
 *
 * Executes searches and returns raw findings.
 * Does NOT update the document - that's the Reflection Agent's job.
 *
 * Single responsibility: Execute searches, return structured findings.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { search, extract } from '@/lib/tools/tavily-search';
import type { SearchFindings, SearchTask } from '@/lib/types/doc-edit';

interface SearchAgentConfig {
  task: SearchTask;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface SearchAgentResult {
  findings: SearchFindings;
  queriesExecuted: string[];
  creditsUsed: number;
}

/**
 * Execute a search task and return raw findings
 */
export async function executeSearch(config: SearchAgentConfig): Promise<SearchAgentResult> {
  const { task, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');

  let creditsUsed = 0;
  const queriesExecuted: string[] = [];

  const trackUsage = (usage: any) => {
    const credits = Math.ceil((usage?.totalTokens || 0) / 1000);
    creditsUsed += credits;
  };

  // Tool to signal completion with findings
  const completeTool = tool({
    description: 'Signal that search is complete and return findings',
    inputSchema: z.object({
      summary: z.string().describe('Brief summary of what was found across all searches'),
      keyTakeaways: z.array(z.string()).describe('Key takeaways from the search results'),
    }),
    execute: async ({ summary, keyTakeaways }) => {
      return { summary, keyTakeaways };
    }
  });

  const systemPrompt = `You are a Search Agent. Your ONLY job is to execute searches and gather information.

TASK: ${task.task}

CONTEXT:
${task.context}

OBJECTIVE: ${task.objective}
DONE_WHEN: ${task.doneWhen}

PREVIOUS QUERIES (avoid duplicates):
${task.previousQueries.length > 0 ? task.previousQueries.slice(-10).join('\n') : '(none yet)'}

INSTRUCTIONS:
1. Execute 1-3 targeted searches to address the task
2. Be specific - don't repeat queries that have been run
3. After searching, use the complete tool to summarize your findings

You have two search tools:
- search: For web searches. Write natural language questions.
- extract: For scraping specific URLs when you need detailed info from a page.

IMPORTANT:
- You are ONLY searching. You do NOT update any document.
- Return raw findings that another agent will analyze.
- Be efficient - specific queries > broad queries.`;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const allQueryResults: SearchFindings['queries'] = [];

  // First search call
  messages.push({
    role: 'user',
    content: `Execute your search for: ${task.task}\n\nRemember to avoid these already-run queries:\n${task.previousQueries.slice(-5).join('\n') || '(none)'}`
  });

  onProgress?.({
    type: 'search_agent_started',
    task: task.task
  });

  // Allow multiple search iterations (up to 3)
  for (let iteration = 0; iteration < 3; iteration++) {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: { search, extract, complete: completeTool },
      abortSignal
    });

    trackUsage(result.usage);

    // Process tool calls
    for (const toolCall of result.toolCalls || []) {
      const tc = toolCall as any;

      if (tc.toolName === 'search') {
        // Vercel AI SDK uses 'input' not 'args'
        const queries = (tc as any).input?.queries || tc.args?.queries || [];

        onProgress?.({
          type: 'search_started',
          count: queries.length,
          queries
        });

        // Get the results from toolResults - property is 'output' not 'result'
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const toolOutput = (toolResult as any)?.output || (toolResult as any)?.result || {};
        const searchResults = toolOutput.results || [];
        console.log('[Search Agent] Got', searchResults.length, 'search results');

        for (const sr of searchResults) {
          queriesExecuted.push(sr.query);
          allQueryResults.push({
            query: sr.query,
            purpose: sr.purpose,
            answer: sr.answer || '',
            sources: (sr.results || []).map((r: any) => ({
              url: r.url,
              title: r.title
            })),
            status: sr.status === 'success' ? 'success' : sr.results?.length > 0 ? 'success' : 'no_results'
          });
        }

        // Emit completed with the results
        const batchQueries = allQueryResults.slice(-(searchResults.length || queries.length));

        onProgress?.({
          type: 'search_completed',
          totalSearches: queriesExecuted.length,
          queries: batchQueries
        });

        // Add to messages for context
        const searchSummary = searchResults.map((sr: any) =>
          `Query: ${sr.query}\nAnswer: ${sr.answer || 'No direct answer'}\nSources: ${(sr.results || []).length}`
        ).join('\n\n');

        messages.push({
          role: 'assistant',
          content: `Searched:\n${searchSummary}`
        });
      }

      if (tc.toolName === 'extract') {
        const urls = (tc as any).input?.urls || tc.args?.urls || [];
        const purpose = (tc as any).input?.purpose || tc.args?.purpose;
        onProgress?.({
          type: 'extract_started',
          urls,
          purpose
        });

        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const extractResults = (toolResult as any)?.output || (toolResult as any)?.result || { results: [], failed: [] };

        onProgress?.({
          type: 'extract_completed',
          results: extractResults.results,
          failed: extractResults.failed
        });

        messages.push({
          role: 'assistant',
          content: `Extracted ${extractResults.results?.length || 0} pages`
        });
      }

      if (tc.toolName === 'complete') {
        // Search agent is done
        const toolResult = result.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId);
        const completionData = (toolResult as any)?.output || (toolResult as any)?.result || {};

        onProgress?.({
          type: 'search_agent_completed',
          summary: completionData.summary
        });

        return {
          findings: {
            queries: allQueryResults,
            summary: completionData.summary
          },
          queriesExecuted,
          creditsUsed
        };
      }
    }

    // If no tool calls, break
    if (!result.toolCalls || result.toolCalls.length === 0) {
      break;
    }

    // Add prompt for next iteration
    messages.push({
      role: 'user',
      content: 'Continue searching if needed, or call the complete tool to summarize your findings.'
    });
  }

  // If we exit without completing, return what we have
  return {
    findings: {
      queries: allQueryResults,
      summary: 'Search completed without explicit summary'
    },
    queriesExecuted,
    creditsUsed
  };
}

/**
 * Create a search task from document context
 */
export function createSearchTask(
  actionToExecute: string,
  docContext: string,
  objective: string,
  doneWhen: string,
  previousQueries: string[]
): SearchTask {
  return {
    task: actionToExecute,
    context: docContext,
    objective,
    doneWhen,
    previousQueries
  };
}
