/**
 * Tracked Generate - Drop-in wrapper for generateText that auto-tracks calls
 *
 * Usage:
 *   // Before:
 *   const result = await generateText({ model, prompt, ... });
 *
 *   // After:
 *   const result = await trackedGenerate('brain_evaluate', { model, prompt, ... });
 */

import { generateText, GenerateTextResult } from 'ai';
import { trackLlmCall } from './index';

type GenerateTextParams = Parameters<typeof generateText>[0];

export async function trackedGenerate<T extends GenerateTextParams>(
  agentId: string,
  params: T,
  options?: {
    chatSessionId?: string;
  }
): Promise<GenerateTextResult<any, any>> {
  const startTime = Date.now();

  // Run the actual call
  const result = await generateText(params);

  const durationMs = Date.now() - startTime;

  // Track it (fire and forget - don't slow down the main flow)
  trackLlmCall({
    agentId,
    model: typeof params.model === 'string' ? params.model : params.model.modelId || 'unknown',
    systemPrompt: 'system' in params ? (params.system as string) : undefined,
    input: 'prompt' in params ? params.prompt : ('messages' in params ? params.messages : null),
    output: result.output ?? result.text,
    durationMs,
    tokenCount: result.usage?.totalTokens,
    chatSessionId: options?.chatSessionId,
  }).catch(err => {
    console.error('[Eval] Failed to track call:', err);
  });

  return result;
}
