import { tool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';

// Perplexity uses OpenAI-compatible API
const perplexity = createOpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY!,
  baseURL: 'https://api.perplexity.ai/',
});

export const perplexitySearch = tool({
  description: 'Search the web using Perplexity AI. Returns AI-generated answers with citations and sources. Use this to find specific facts, companies, people, contacts, current events, or any information that requires web research. Perplexity will analyze multiple sources and provide a comprehensive answer with references.',
  inputSchema: z.object({
    query: z.string().describe('The search query - be specific to get better results'),
    searchDepth: z.enum(['basic', 'advanced']).optional().describe('basic = faster search, advanced = more thorough research with more sources')
  }),
  execute: async ({ query, searchDepth = 'basic' }) => {
    try {
      // Use Perplexity's sonar model for web search
      const model = searchDepth === 'advanced' ? 'sonar-pro' : 'sonar';

      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a research assistant. Provide comprehensive, factual answers with specific details like names, companies, contacts, and URLs. Be precise and cite your sources.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: 0.2,
          return_citations: true,
          return_images: false
        })
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.statusText}`);
      }

      const data = await response.json();

      // Extract answer and citations
      const answer = data.choices[0]?.message?.content || 'No answer returned';
      const citations = data.citations || [];

      return {
        query,
        answer,
        citations,
        sources: citations.map((url: string, idx: number) => ({
          title: `Source ${idx + 1}`,
          url
        })),
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('Perplexity search error:', error);
      return {
        query,
        answer: `Search failed: ${error.message}`,
        citations: [],
        sources: [],
        timestamp: new Date().toISOString()
      };
    }
  }
});
