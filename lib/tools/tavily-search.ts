// Tavily Search Tool - supports single or batch queries
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const search = tool({
  description: `Search the web. Write HUMAN-READABLE questions.

Your queries should sound like asking a knowledgeable friend:
✅ "What are the biggest challenges podcast producers face with fact-checking?"
✅ "Which media companies have been criticized for spreading misinformation?"
❌ "podcast fact-check challenges 2024" (keyword soup)
❌ "misinformation media companies list" (not a question)

Each query needs:
- query: The human-readable question
- purpose: What you're trying to learn (1 sentence)

Run 1-2 queries at a time. Focused beats broad.`,
  inputSchema: z.object({
    queries: z.array(z.object({
      query: z.string(),
      purpose: z.string()
    })).min(1).max(3)
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
