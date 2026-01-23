// Tavily Search & Extract Tools
import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;

export const search = tool({
  description: `Search the web. Queries must be HUMAN-READABLE and SPECIFIC.

Write like you're asking a knowledgeable person, not keyword stuffing:
✅ "Who leads DevRel at Datadog?"
✅ "What startups make podcast fact-checking tools?"
✅ "Is Sarah Chen active on Twitter?"
❌ "DevRel leads Datadog 2024" (keyword soup)
❌ "podcast fact-check tools startups list" (not a question)

Each query needs:
- query: A clear, specific question a human would ask
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

// Extract tool - scrape specific URLs for detailed content
export const extract = tool({
  description: `Extract detailed content from specific URLs.

Use this AFTER search when you need specifics that search summaries don't provide:
- Contact pages → get actual names, emails, roles
- Team/About pages → get decision-maker names
- Pricing pages → get actual pricing details
- Product pages → get specific features

DON'T extract randomly. Only extract URLs likely to have the specific info you need.
Max 5 URLs per call.`,
  inputSchema: z.object({
    urls: z.array(z.string().url()).min(1).max(5).describe('URLs to extract content from'),
    purpose: z.string().describe('What specific info are you looking for on these pages?')
  }),
  execute: async ({ urls, purpose }) => {
    try {
      const response = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TAVILY_API_KEY}`
        },
        body: JSON.stringify({
          urls,
          extract_depth: 'basic',
          format: 'markdown',
          include_images: false
        })
      });

      if (!response.ok) {
        throw new Error(`Extract API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        purpose,
        results: (data.results || []).map((r: any) => ({
          url: r.url,
          content: r.raw_content?.substring(0, 3000) || 'No content extracted'
        })),
        failed: (data.failed_results || []).map((f: any) => ({
          url: f.url,
          error: f.error
        })),
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        purpose,
        results: [],
        failed: urls.map(url => ({ url, error: error.message })),
        timestamp: new Date().toISOString()
      };
    }
  }
});
