// Tavily Search & Extract Tools
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;

export const search = tool({
  description: `Search the web. Please keep each query atomic (one thing at a time).

Ask ONE clear question per query (no multi-part "and/or" questions). If you need two pieces of info, do two searches.
✅ "Who leads DevRel at Datadog?"
✅ "What startups make podcast fact-checking tools?"
❌ "Who leads DevRel at Datadog and what is their background?" (split)
❌ "What podcast tools exist and who uses them?" (split)

Write like you're asking a knowledgeable person:
✅ "Is Sarah Chen still at Spotify?"
❌ "Sarah Chen Spotify 2024" (keyword soup)

Each query needs:
- query: ONE clear, specific question
- purpose: What you're trying to learn

Run ONE query at a time. After each query, reflect on what you learned before searching again.`,
  inputSchema: z.object({
    queries: z.array(z.object({
      query: z.string(),
      purpose: z.string()
    })).min(1).max(1)
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

