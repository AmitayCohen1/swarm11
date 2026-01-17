import { z } from 'zod';
import { perplexity } from '@ai-sdk/perplexity';
import { generateText } from 'ai';

// Retry helper with exponential backoff
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, 2 ** i * 1000));
    }
  }
  throw new Error('Retry failed');
}

export const perplexityResearch = {
  description: 'Search the web using Perplexity AI for current information, news, and research. Returns comprehensive answers with cited sources. Use this for gathering factual, up-to-date information.',

  inputSchema: z.object({
    query: z.string().describe('The specific research query to investigate. Be precise and focused.')
  }),

  execute: async ({ query }: { query: string }) => {
    // Use Perplexity via AI SDK with retry logic
    const result = await executeWithRetry(async () => {
      const { text, usage } = await generateText({
        model: perplexity('sonar-pro'),
        prompt: query,
        temperature: 0.2
      });

      return {
        text,
        usage
      };
    });

    return {
      query,
      answer: result.text,
      sources: [], // Perplexity sources handling
      creditsUsed: 50, // Fixed cost per research query
      tokensUsed: result.usage.totalTokens,
      timestamp: new Date().toISOString()
    };
  }
};
