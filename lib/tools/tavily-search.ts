// Tavily Search Tool
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const tavilySearch = tool({
  description: 'Search the web using FULL NATURAL LANGUAGE QUESTIONS. Returns AI-generated answer PLUS full extracted text content from each result. CRITICAL: Use complete questions like "What are the most popular finance podcasts in 2024?" NOT keyword strings like "finance podcasts 2024".',
  inputSchema: z.object({
    query: z.string().describe('FULL NATURAL LANGUAGE QUESTION. Example: "What companies are hiring DevRel engineers in 2024?" NOT "devrel hiring 2024". Always use complete, readable questions.'),
    searchDepth: z.enum(['basic', 'advanced']).optional().describe('basic = 5 results (fast), advanced = 10 results (deeper)')
  }),
  execute: async ({ query, searchDepth = 'basic' }) => {
    const response = await client.search(query, {
      searchDepth,
      maxResults: searchDepth === 'advanced' ? 10 : 5,
      includeAnswer: true
    });

    return {
      query,
      answer: response.answer || null,
      results: (response.results as any[]).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score
      })),
      timestamp: new Date().toISOString()
    };
  }
});
