// Tavily Search Tool
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const tavilySearch = tool({
  description: 'Search the web using FULL NATURAL LANGUAGE QUESTIONS. Returns AI-generated answer PLUS full extracted text content from each result. CRITICAL: Use complete questions like "What are the most popular podcasts in 2024?" NOT keyword strings like "podcasts 2024".',
  inputSchema: z.object({
    query: z.string().describe('FULL NATURAL LANGUAGE QUESTION. Always use complete, readable questions like "What are the best options for X?" NOT keyword strings like "best X options".'),
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
