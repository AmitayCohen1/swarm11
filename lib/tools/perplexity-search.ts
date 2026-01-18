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
              content: 'Be concise. Focus on SPECIFIC names, companies, contacts, URLs, and actionable information. Skip background info. Give direct answers with key details only.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: 0.1,
          return_citations: true,
          return_images: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Perplexity API error:', errorText);
        throw new Error(`Perplexity API error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Perplexity response:', JSON.stringify(data, null, 2));

      // Extract answer and citations
      const answer = data.choices[0]?.message?.content || 'No answer returned';

      // Perplexity returns citations in the response object, not in choices
      const citations = data.citations || [];

      // Build sources array with actual URLs
      const sources = citations.length > 0
        ? citations.map((url: string, idx: number) => ({
            title: url.includes('://') ? new URL(url).hostname : `Source ${idx + 1}`,
            url
          }))
        : [];

      return {
        query,
        answer,
        citations,
        sources,
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
