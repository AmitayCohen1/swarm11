/**
 * Reflection Agent - Version 4
 * Analyzes findings and produces item-based edits (add/remove/edit)
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ReflectionOutput, SearchFindings } from '@/lib/types/doc-edit';

interface ReflectionAgentConfig {
  currentDoc: string;
  rawFindings: SearchFindings;
  objective: string;
  doneWhen: string;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ReflectionAgentResult {
  output: ReflectionOutput;
  creditsUsed: number;
}

export async function analyzeAndReflect(config: ReflectionAgentConfig): Promise<ReflectionAgentResult> {
  const { currentDoc, rawFindings, objective, doneWhen, abortSignal, onProgress } = config;
  const model = openai('gpt-5.1');

  let creditsUsed = 0;

  const trackUsage = (usage: any) => {
    creditsUsed += Math.ceil((usage?.totalTokens || 0) / 1000);
  };

  const reflectTool = tool({
    description: 'Output your analysis and document edits',
    inputSchema: z.object({
      reasoning: z.string().describe('Brief analysis: what did you learn from these findings?'),

      edits: z.array(z.object({
        action: z.enum(['add_item', 'remove_item', 'edit_item']),
        sectionTitle: z.string().describe('Section name (created if new)'),
        itemId: z.string().optional().describe('Required for remove_item/edit_item - use ID from document'),
        content: z.string().optional().describe('Required for add_item/edit_item - markdown content'),
        sources: z.array(z.object({
          url: z.string(),
          title: z.string()
        })).optional().describe('Sources for this item')
      })).describe('List of edit operations to apply'),

      strategyUpdate: z.object({
        approach: z.string().describe('Current research approach'),
        rationale: z.string().describe('Why this approach'),
        nextActions: z.array(z.string()).describe('1-3 next steps')
      }).optional().describe('Update strategy if direction changes'),

      shouldContinue: z.boolean().describe('false = DONE_WHEN satisfied or impossible'),
    }),
    execute: async (params) => params
  });

  const systemPrompt = `You are a Reflection Agent. Analyze search findings and edit the research document.

OBJECTIVE: ${objective}
DONE_WHEN: ${doneWhen}

CURRENT DOCUMENT:
${currentDoc}

RAW FINDINGS:
${formatFindings(rawFindings)}

YOUR JOB:
1. Extract useful facts from findings
2. Add them to appropriate sections
3. Remove outdated/incorrect items if needed
4. Edit items that need updating

EDIT OPERATIONS:
- **add_item**: Add a new fact to a section (creates section if needed)
- **remove_item**: Remove an item by its ID (use [item_xxx] from document)
- **edit_item**: Update an existing item's content

CONTENT STYLE:
Write clean, factual items. Each item should be a discrete fact or finding.

GOOD items:
- "**NPR** - Collin Campbell (Podcast Chief) - linkedin.com/in/..."
- "Pricing: $49/mo (Starter), $99/mo (Pro), $249/mo (Enterprise)"
- "Key competitor: Acme Corp - offers similar features at 20% lower price"

BAD items:
- "Recent research suggests that..." (meta-commentary)
- "We found that there might be..." (hedging)
- "Further investigation needed for..." (process notes)

WHEN TO EDIT vs ADD:
- If new info updates/corrects existing item → edit_item
- If new info is distinct/separate → add_item
- If info is wrong/outdated → remove_item

STOP (shouldContinue = false) when:
- DONE_WHEN is clearly satisfied, OR
- DONE_WHEN is proven impossible`;

  onProgress?.({ type: 'reflection_started' });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Analyze findings and output edits using the reflect tool.',
    tools: { reflect: reflectTool },
    toolChoice: { type: 'tool', toolName: 'reflect' },
    abortSignal
  });

  trackUsage(result.usage);

  const toolCall = result.toolCalls?.[0] as any;

  if (toolCall?.toolName === 'reflect') {
    const args = toolCall.input || toolCall.args || {};

    const output: ReflectionOutput = {
      edits: args.edits || [],
      strategyUpdate: args.strategyUpdate,
      shouldContinue: args.shouldContinue ?? true,
      reasoning: args.reasoning || ''
    };

    onProgress?.({
      type: 'reflection_completed',
      editsCount: output.edits.length,
      shouldContinue: output.shouldContinue,
      reasoning: output.reasoning
    });

    return { output, creditsUsed };
  }

  return {
    output: {
      edits: [],
      shouldContinue: true,
      reasoning: 'No output from reflection'
    },
    creditsUsed
  };
}

function formatFindings(findings: SearchFindings): string {
  if (!findings.queries?.length) return '(No results)';

  const parts: string[] = [];

  for (const q of findings.queries) {
    parts.push(`**Query:** ${q.query}`);
    parts.push(`**Purpose:** ${q.purpose}`);
    if (q.answer) parts.push(`**Answer:** ${q.answer}`);
    if (q.sources.length > 0) {
      parts.push('**Sources:**');
      for (const s of q.sources.slice(0, 5)) {
        parts.push(`- [${s.title}](${s.url})`);
      }
    }
    parts.push('---');
  }

  return parts.join('\n');
}
