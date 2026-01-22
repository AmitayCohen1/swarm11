/**
 * Reflection Agent
 *
 * Analyzes search findings and produces edit operations for the document.
 * Does NOT execute searches - that's the Search Agent's job.
 *
 * Single responsibility: Analyze findings, produce document edits.
 */

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ReflectionOutput, SearchFindings } from '@/lib/types/doc-edit';
import { DEFAULT_SECTION_TITLES } from '@/lib/types/research-doc';

interface ReflectionAgentConfig {
  currentDoc: string;           // Formatted document content
  rawFindings: SearchFindings;  // Raw findings from Search Agent
  objective: string;
  doneWhen: string;
  abortSignal?: AbortSignal;
  onProgress?: (update: any) => void;
}

interface ReflectionAgentResult {
  output: ReflectionOutput;
  creditsUsed: number;
}

/**
 * Analyze findings and produce document edits
 */
export async function analyzeAndReflect(config: ReflectionAgentConfig): Promise<ReflectionAgentResult> {
  const { currentDoc, rawFindings, objective, doneWhen, abortSignal, onProgress } = config;
  const model = openai('gpt-4.1');

  let creditsUsed = 0;

  const trackUsage = (usage: any) => {
    const credits = Math.ceil((usage?.totalTokens || 0) / 1000);
    creditsUsed += credits;
  };

  // Tool to output reflection results
  const reflectTool = tool({
    description: 'Output your analysis and document edit operations',
    inputSchema: z.object({
      reasoning: z.string().describe('Explain your analysis: what did you learn? how does it relate to the objective?'),

      documentEdits: z.array(z.object({
        action: z.enum(['add_items', 'remove_items', 'replace_all']).describe('add_items=add new items, remove_items=remove by id, replace_all=replace entire section'),
        sectionTitle: z.string().describe(`Section: "${DEFAULT_SECTION_TITLES.KEY_FINDINGS}", "${DEFAULT_SECTION_TITLES.OPEN_QUESTIONS}", "${DEFAULT_SECTION_TITLES.DEAD_ENDS}", or "${DEFAULT_SECTION_TITLES.RAW_NOTES}"`),
        items: z.array(z.object({
          text: z.string().describe('The item content - one finding, question, or note per item'),
          sources: z.array(z.object({
            url: z.string(),
            title: z.string()
          })).optional().describe('Sources for this specific item')
        })).optional().describe('Items to add (for add_items or replace_all)'),
        itemIds: z.array(z.string()).optional().describe('Item IDs to remove (for remove_items)')
      })).describe('Edit operations - each item is ONE finding/question/note'),

      strategyUpdate: z.object({
        approach: z.string().describe('Updated research approach based on findings'),
        rationale: z.string().describe('Why this approach makes sense now'),
        nextActions: z.array(z.string()).describe('Specific next actions to take (1-3 items)')
      }).optional().describe('Update the research strategy if needed'),

      shouldContinue: z.boolean().describe('Should research continue? false = DONE_WHEN is satisfied or proven impossible'),

      doneWhenAssessment: z.string().describe('Explicit assessment: How close are we to satisfying DONE_WHEN? What remains?')
    }),
    execute: async (params) => params
  });

  const systemPrompt = `You are a Reflection Agent analyzing research findings.

OBJECTIVE: ${objective}
DONE_WHEN: ${doneWhen}

CURRENT DOCUMENT:
${currentDoc}

RAW FINDINGS FROM SEARCH:
${formatFindings(rawFindings)}

YOUR JOB:
1. Analyze what was found
2. Decide what's worth adding to the document
3. Decide if strategy needs to change
4. Assess progress toward DONE_WHEN
5. Output structured edit operations

SECTIONS (each contains a list of items):
- "${DEFAULT_SECTION_TITLES.KEY_FINDINGS}" - Core discoveries, facts (one finding per item)
- "${DEFAULT_SECTION_TITLES.OPEN_QUESTIONS}" - Unanswered questions (one question per item)
- "${DEFAULT_SECTION_TITLES.DEAD_ENDS}" - Failed approaches (one dead end per item)
- "${DEFAULT_SECTION_TITLES.RAW_NOTES}" - Observations, quotes (one note per item)

EDIT ACTIONS:
- add_items: Add new items to a section
- remove_items: Remove items by their ID (use when question answered or note promoted)
- replace_all: Replace all items in section (use to consolidate/deduplicate)

ITEM FORMAT:
Each item has: text (the content) and optional sources [{url, title}]
One fact/question/note per item. Keep items focused and concise.

RULES:
- Be selective - not everything is worth documenting
- When a question gets answered, use remove_items on Open Questions
- When promoting Raw Notes to Key Findings, remove from Raw Notes
- Use replace_all to consolidate when items are redundant

STOP CRITERIA (shouldContinue = false):
- DONE_WHEN is clearly satisfied, OR
- DONE_WHEN is proven impossible to satisfy

If neither, set shouldContinue = true.`;

  onProgress?.({
    type: 'reflection_started'
  });

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: 'Analyze the findings and produce document edits using the reflect tool.',
    tools: { reflect: reflectTool },
    toolChoice: { type: 'tool', toolName: 'reflect' },
    abortSignal
  });

  trackUsage(result.usage);

  // Extract the reflection output
  const toolCall = result.toolCalls?.[0] as any;
  console.log('[Reflection] Tool call:', toolCall?.toolName);
  console.log('[Reflection] Has input:', !!toolCall?.input, 'Has args:', !!toolCall?.args);

  if (toolCall && toolCall.toolName === 'reflect') {
    const args = toolCall.input || toolCall.args || {};
    console.log('[Reflection] documentEdits count:', args.documentEdits?.length);
    console.log('[Reflection] shouldContinue:', args.shouldContinue);

    const output: ReflectionOutput = {
      documentEdits: args.documentEdits || [],
      strategyUpdate: args.strategyUpdate,
      shouldContinue: args.shouldContinue ?? true,
      reasoning: args.reasoning || 'No reasoning provided'
    };

    onProgress?.({
      type: 'reflection_completed',
      editsApplied: output.documentEdits.length,
      shouldContinue: output.shouldContinue,
      reasoning: output.reasoning,
      doneWhenAssessment: args.doneWhenAssessment
    });

    return {
      output,
      creditsUsed
    };
  }

  // Fallback if no tool call
  return {
    output: {
      documentEdits: [],
      shouldContinue: true,
      reasoning: 'Reflection agent did not produce output'
    },
    creditsUsed
  };
}

/**
 * Format search findings for the reflection prompt
 */
function formatFindings(findings: SearchFindings): string {
  if (!findings.queries || findings.queries.length === 0) {
    return '(No search results)';
  }

  const parts: string[] = [];

  for (const q of findings.queries) {
    parts.push(`**Query:** ${q.query}`);
    parts.push(`**Purpose:** ${q.purpose}`);
    parts.push(`**Status:** ${q.status}`);
    if (q.answer) {
      parts.push(`**Answer:** ${q.answer}`);
    }
    if (q.sources.length > 0) {
      parts.push('**Sources:**');
      for (const s of q.sources.slice(0, 5)) {
        parts.push(`- [${s.title}](${s.url})`);
      }
    }
    parts.push('---');
  }

  if (findings.summary) {
    parts.push(`\n**Search Summary:** ${findings.summary}`);
  }

  return parts.join('\n');
}

/**
 * Quick check if findings suggest we're done
 * Used for early termination detection
 */
export function quickDoneCheck(
  findings: SearchFindings,
  doneWhen: string
): { likelyDone: boolean; confidence: 'low' | 'medium' | 'high'; reason: string } {
  // Simple heuristics - the full reflection will make the final call
  const allAnswers = findings.queries.map(q => q.answer).join(' ').toLowerCase();
  const doneWhenLower = doneWhen.toLowerCase();

  // Check for explicit signals
  const hasNotFound = allAnswers.includes('not found') || allAnswers.includes('no results');
  const hasFound = allAnswers.includes('found') || allAnswers.includes('identified');

  // Check for quantity indicators in doneWhen
  const quantityMatch = doneWhenLower.match(/(\d+)\s*(leads?|prospects?|items?|results?)/);
  if (quantityMatch) {
    const targetCount = parseInt(quantityMatch[1]);
    // Count how many sources we have
    const totalSources = findings.queries.reduce((acc, q) => acc + q.sources.length, 0);

    if (totalSources >= targetCount) {
      return {
        likelyDone: true,
        confidence: 'medium',
        reason: `Found ${totalSources} sources, target was ${targetCount}`
      };
    }
  }

  // Check for "impossible" signals
  if (hasNotFound && findings.queries.length >= 3) {
    return {
      likelyDone: false,
      confidence: 'low',
      reason: 'Multiple searches returned no results - may be impossible'
    };
  }

  return {
    likelyDone: false,
    confidence: 'low',
    reason: 'No clear completion signal detected'
  };
}
