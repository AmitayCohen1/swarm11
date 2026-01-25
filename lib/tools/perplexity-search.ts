// Perplexity Search Tool
// Uses official AI SDK Perplexity provider for web search with citations

import { tool } from 'ai';
import { generateText } from 'ai';
import { perplexity } from '@ai-sdk/perplexity';
import { z } from 'zod';

export const search = tool({
  description: `Search the web using Perplexity for comprehensive, detailed answers with citations.

Ask ONE clear question per query. Write like you're asking a knowledgeable researcher:
✅ "Who leads DevRel at Datadog and what is their background?"
✅ "What startups make podcast fact-checking tools? List the top 5 with their funding."
✅ "Is Sarah Chen still at Spotify? What role does she have?"

Each query needs:
- query: A clear, specific question (can be detailed)
- purpose: What you're trying to learn

Run ONE query at a time. After each query, reflect on what you learned before searching again.`,
  inputSchema: z.object({
    queries: z.array(z.object({
      query: z.string(),
      purpose: z.string()
    })).min(1).max(1)
  }),
  execute: async ({ queries }) => {
    console.log('[Perplexity] Received queries:', JSON.stringify(queries, null, 2));

    const results = await Promise.all(
      queries.map(async ({ query, purpose }) => {
        console.log('[Perplexity] Searching for:', query);
        try {
          const result = await generateText({
            model: perplexity('sonar'),
            system: `You are a thorough research assistant. Provide DETAILED, comprehensive answers with:
- Specific names, titles, and companies
- Numbers, dates, and statistics when available
- Context and background that helps understand the topic
- Multiple examples or options when relevant

Don't be brief. Give complete, well-researched answers that would satisfy a professional researcher.`,
            prompt: query
          });

          const answer = result.text || '';
          const sources = result.sources || [];

          console.log('[Perplexity] Answer length:', answer.length, 'sources:', sources.length);

          // Build sources array
          const formattedSources = sources.map((source: any, idx: number) => ({
            title: source.title || source.url || `Source ${idx + 1}`,
            url: source.url || '',
            content: source.snippet || '',
            score: 1 - (idx * 0.1)
          }));

          return {
            query,
            purpose,
            answer,
            results: formattedSources,
            status: 'success' as const
          };
        } catch (error: any) {
          console.error('[Perplexity Search Error]', error.message);
          return {
            query,
            purpose,
            answer: '',
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
