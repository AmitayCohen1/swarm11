/**
 * Web Search - Simple Perplexity wrapper
 */

import { generateText } from 'ai';
import { perplexity } from '@ai-sdk/perplexity';
// import { buildSearchSystemPrompt } from '@/lib/prompts/research';

export interface SearchResult {
  answer: string;
  sources: Array<{ title: string; url: string }>;
}

export async function searchWeb(query: string): Promise<SearchResult> {
  console.log('[Search] Query:', query);

  try {
    const result = await generateText({
      model: perplexity('sonar'),
      // PROMPT GOAL (Search): Execute a single web search and return a detailed answer + sources.
      // The Researcher later truncates `answer` when deciding next steps, so the opening should be high-signal.
      // system: buildSearchSystemPrompt(),
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
