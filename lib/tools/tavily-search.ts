// Tavily Search Tool - supports single or batch queries
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const search = tool({
  description: 'Search the web. Accepts a single query OR multiple queries (run in parallel via Promise.all). Each query should be a FULL NATURAL LANGUAGE QUESTION.',
  inputSchema: z.object({
    queries: z.array(z.object({
      query: z.string().describe('FULL NATURAL LANGUAGE QUESTION'),
      purpose: z.string().describe('What uncertainty does this test?')
    })).min(1).max(5).describe('1-5 queries. Use multiple for exploration, single for narrowing.')
  }),
  execute: async ({ queries }) => {
    const results = await Promise.all(
      queries.map(async ({ query, purpose }) => {
        try {
          const response = await client.search(query, {
            searchDepth: 'basic',
            maxResults: 5,
            includeAnswer: true
          });

          return {
            query,
            purpose,
            answer: response.answer || null,
            results: (response.results as any[]).map((r: any) => ({
              title: r.title,
              url: r.url,
              content: r.content,
              score: r.score
            })),
            status: 'success' as const
          };
        } catch (error: any) {
          return {
            query,
            purpose,
            answer: null,
            results: [],
            status: 'error' as const,
            error: error.message
          };
        }
      })
    );

    return {
      count: queries.length,
      results,
      timestamp: new Date().toISOString()
    };
  }
});
