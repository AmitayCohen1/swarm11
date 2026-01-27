/**
 * Web Search - Simple Perplexity wrapper
 */

import { generateText } from 'ai';
import { perplexity } from '@ai-sdk/perplexity';
import { trackLlmCall } from '@/lib/eval';
// import { buildSearchSystemPrompt } from '@/lib/prompts/research';

export interface SearchResult {
  answer: string;
  sources: Array<{ title: string; url: string }>;
}

export async function searchWeb(query: string): Promise<SearchResult> {
  console.log('[Search] Query:', query);

  const normalizeUrl = (url: string) => {
    const u = (url || '').trim();
    if (!u) return '';
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    return `https://${u.replace(/^\/+/, '')}`;
  };

  try {
    const run = async (modelName: 'sonar' | 'sonar-pro') => {
      return await generateText({
        model: perplexity(modelName),
        prompt: query
      });
    };

    // `sonar` is cheaper/faster but often returns no sources. If sources are empty,
    // retry once with `sonar-pro` so the UI can show citations.
    let { text, sources: rawSources } = await run('sonar');
    if (!rawSources || rawSources.length === 0) {
      const pro = await run('sonar-pro');
      text = pro.text;
      rawSources = pro.sources;
    }

    const answer = text || '';
    const sources = (rawSources || [])
      .map((s: any, idx: number) => {
        const url = normalizeUrl(s.url || '');
        return {
          title: (s.title || '').trim() || url || `Source ${idx + 1}`,
          url
        };
      })
      .filter((s: any) => Boolean(s.url));

    console.log('[Search] Answer length:', answer.length, 'sources:', sources.length);

    // Track for evaluation
    trackLlmCall({
      agentId: 'HUP_QEr0v0IX', // Web Search
      model: 'perplexity-sonar',
      input: { query },
      output: { answerLength: answer.length, sourcesCount: sources.length, answerPreview: answer.substring(0, 500) },
    }).catch(() => {}); // Fire and forget

    return { answer, sources };
  } catch (error: any) {
    console.error('[Search Error]', error.message);
    return { answer: '', sources: [] };
  }
}
