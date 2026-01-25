/**
 * Web Search - Simple Perplexity wrapper
 */

import { generateText } from 'ai';
import { perplexity } from '@ai-sdk/perplexity';

export interface SearchResult {
  answer: string;
  sources: Array<{ title: string; url: string }>;
}

export async function searchWeb(query: string): Promise<SearchResult> {
  console.log('[Search] Query:', query);

  try {
    const result = await generateText({
      model: perplexity('sonar'),
      system: `You are a thorough research assistant. Provide DETAILED, comprehensive answers with:
- Specific names, titles, and companies
- Numbers, dates, and statistics when available
- Context and background that helps understand the topic
- Multiple examples or options when relevant

Don't be brief. Give complete, well-researched answers.`,
      prompt: query
    });

    const answer = result.text || '';
    const sources = (result.sources || []).map((s: any, idx: number) => ({
      title: s.title || s.url || `Source ${idx + 1}`,
      url: s.url || ''
    }));

    console.log('[Search] Answer length:', answer.length, 'sources:', sources.length);

    return { answer, sources };
  } catch (error: any) {
    console.error('[Search Error]', error.message);
    return { answer: '', sources: [] };
  }
}
