import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { searchWeb } from '../research/search';
import { intakePrompt } from '@/lib/prompts/research';

export interface ResearchBrief {
  objective: string;
  successCriteria: string[];
}

export interface OrchestratorDecision {
  type: 'text_input' | 'multi_choice_select' | 'start_research';
  message: string;
  reasoning: string;
  reason?: string;
  options?: { label: string }[];
  researchBrief?: ResearchBrief;
  searchPerformed?: {
    query: string;
    answer: string;
  };
}

// Tools
const textInput = tool({
  description: 'Ask the user a question that requires a text response',
  inputSchema: z.object({
    message: z.string().describe('The question to ask'),
    reason: z.string().optional().describe('Why you need this info')
  })
});

const multiChoiceSelect = tool({
  description: 'Ask the user to select one of several options',
  inputSchema: z.object({
    message: z.string().describe('The question to ask'),
    options: z.array(z.object({
      label: z.string().describe('2-4 word option label')
    })).min(2).max(4).describe('2-4 options to choose from'),
    reason: z.string().optional().describe('Why you need this info')
  })
});

const startResearch = tool({
  description: 'Start the research process once you have enough information',
  inputSchema: z.object({
    message: z.string().describe('Confirmation message to user'),
    objective: z.string().describe('Clear research objective'),
    successCriteria: z.array(z.string()).min(1).max(4).describe('1-4 success criteria')
  })
});

// Search tool - NO execute, we handle it manually
const quick_web_search = tool({
  description: 'Search the web to look up unfamiliar companies, products, or terms',
  inputSchema: z.object({
    query: z.string().describe('The search query')
  })
});

const INTAKE_INSTRUCTIONS = intakePrompt();

/**
 * Simple two-step intake:
 * 1. Call LLM - might request search
 * 2. If search requested: execute it, call LLM again with results
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string,
  onProgress?: (update: { type: string; query?: string; answer?: string }) => void
): Promise<OrchestratorDecision> {

  // Build messages
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of conversationHistory) {
    if (m.role === 'user' && m.content) {
      if (m.metadata?.type === 'option_selected') {
        const unselected = m.metadata?.unselectedOptionLabels as string[] | undefined;
        if (unselected && unselected.length > 0) {
          messages.push({ role: 'user', content: `Selected: "${m.content}" (other options were: ${unselected.join(', ')})` });
        } else {
          messages.push({ role: 'user', content: `Selected: "${m.content}"` });
        }
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant' && m.content) {
      if (m.metadata?.kind === 'research_result') continue; // Skip long research results

      // For intake_search messages, include the actual search answer
      if (m.metadata?.type === 'intake_search' && m.metadata?.answer) {
        const searchContent = `I looked up "${m.metadata.query}" and found:\n\n${m.metadata.answer}`;
        messages.push({ role: 'assistant', content: searchContent });
      } else {
        messages.push({ role: 'assistant', content: m.content });
      }
    }
  }

  // Add current message
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  if (!(lastMsg?.role === 'user' && lastMsg?.content === userMessage)) {
    messages.push({ role: 'user', content: userMessage });
  }

  console.log('[Intake] ====== STEP 1: Initial call ======');
  console.log('[Intake] Messages:', messages.length);
  console.log('[Intake] Messages list:', JSON.stringify(messages, null, 2));

  // STEP 1: Call with all tools (search has no execute - just returns tool call)
  const result1 = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: INTAKE_INSTRUCTIONS,
    messages,
    tools: { quick_web_search, textInput, multiChoiceSelect, startResearch },
    toolChoice: 'required'
  });

  const toolCall = result1.toolCalls?.[0];
  console.log('[Intake] Tool called:', toolCall?.toolName);
  console.log('[Intake] Tool call full:', JSON.stringify(toolCall, null, 2));

  // If NOT a search, we're done - extract the action
  if (toolCall?.toolName !== 'quick_web_search') {
    console.log('[Intake] No search needed, returning action');
    return extractAction(toolCall);
  }

  // STEP 2: Search was requested - execute it
  const searchArgs = (toolCall as any).args || (toolCall as any).input || {};
  const query = searchArgs.query || '';
  console.log('[Intake] ====== STEP 2: Executing search ======');
  console.log('[Intake] Query:', query);

  onProgress?.({ type: 'intake_searching', query });

  const searchResult = await searchWeb(query);
  const answer = searchResult.answer || 'No results found';

  console.log('[Intake] Search complete, answer length:', answer.length);
  onProgress?.({ type: 'intake_search_complete', query, answer });

  // STEP 3: Call LLM again with search results
  console.log('[Intake] ====== STEP 3: Follow-up with search results ======');

  const messagesWithSearch = [
    ...messages,
    {
      role: 'assistant' as const,
      content: `I looked up "${query}" and found:\n\n${answer}`
    }
  ];

  console.log('[Intake] ---- Messages for STEP 3 ----');
  console.log('[Intake] Count:', messagesWithSearch.length);
  for (const msg of messagesWithSearch) {
    const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
    console.log(`[Intake]   ${msg.role}: "${preview}${msg.content.length > 100 ? '...' : ''}"`);
  }
  console.log('[Intake] ---- End Messages ----');

  const result2 = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: INTAKE_INSTRUCTIONS,
    messages: messagesWithSearch,
    tools: { textInput, multiChoiceSelect, startResearch }, // No search this time
    toolChoice: 'required'
  });

  const finalToolCall = result2.toolCalls?.[0];
  console.log('[Intake] Final tool called:', finalToolCall?.toolName);

  const decision = extractAction(finalToolCall);
  decision.searchPerformed = { query, answer };
  return decision;
}

function extractAction(toolCall: any): OrchestratorDecision {
  if (!toolCall) {
    return {
      type: 'text_input',
      message: 'What would you like me to research?',
      reasoning: 'No tool called'
    };
  }

  // Anthropic uses 'input', OpenAI uses 'args'
  const args = toolCall.args || toolCall.input || {};
  console.log('[Intake] Extracting action:', toolCall.toolName);
  console.log('[Intake] Args:', JSON.stringify(args));

  if (toolCall.toolName === 'startResearch') {
    return {
      type: 'start_research',
      message: args.message || 'Starting research...',
      reasoning: 'Starting research',
      researchBrief: {
        objective: args.objective || '',
        successCriteria: args.successCriteria || []
      }
    };
  }

  if (toolCall.toolName === 'multiChoiceSelect') {
    return {
      type: 'multi_choice_select',
      message: args.message || 'Please select:',
      reasoning: 'Asking options',
      reason: args.reason,
      options: args.options || []
    };
  }

  return {
    type: 'text_input',
    message: args.message || 'Tell me more:',
    reasoning: 'Asking question',
    reason: args.reason
  };
}
