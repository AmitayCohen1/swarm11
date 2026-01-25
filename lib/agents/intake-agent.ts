import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { search } from '../tools/perplexity-search';

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
  // Search info if intake performed a search
  searchPerformed?: {
    query: string;
    answer: string;
  };
}

// Action tools (no execute - they stop the loop)
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


  const INTAKE_INSTRUCTIONS = `You are the research intake agent.
  You are the first step user will take when he wants to research something. After talking to you, the research agent will start researching.
  Your job is to ensure the research agent have enough information to perform the research and provide relevant results.

  Specifically, the research agent needs to know:
  - What he needs to research? 
  - What the user expects to get from the research?
  - Any valuebale inforamtion that could understand the problem better and support the research?
  - Make sure the research agnet wont get confused, ask clarifying questions if needed.

  You can use: 
  - text_input to ask a broad question, where the user type a full response.
  - multi_choice_select to offer options, where the user can select one of the options.
  - search to look up unfamiliar companies, products, or terms.
  - start_research to start the research, once you have enough information to start the research.

Rules:
- One question per turn
- Max 20 words per question
 Use multi_choice_select for normal questions.
 - Use text_input if you fundamentaly don't understand something, and you want a longer response from user.
 - Dont ask questions, that can be resolved during the research.
 - Once you have enough information to start the research, use start_research.

  `;
/**
 * Intake Agent - explicit two-phase approach
 */
export async function analyzeUserMessage(
  userMessage: string,
  conversationHistory: any[],
  brain: string,
  onProgress?: (update: { type: string; query?: string; answer?: string }) => void
): Promise<OrchestratorDecision> {

  // Build messages array
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of conversationHistory) {
    if (m.role === 'user' && m.content) {
      if (m.metadata?.type === 'option_selected') {
        const selected = m.content;
        const allOptions = m.metadata.offeredOptions?.map((o: any) => o.label) || [];
        const notChosen = allOptions.filter((o: string) => o !== selected);
        let content = `Selected: "${selected}"`;
        if (notChosen.length > 0) {
          content += ` (Did NOT choose: ${notChosen.map((o: string) => `"${o}"`).join(', ')})`;
        }
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant' && m.content) {
      let content = m.content;
      if (m.metadata?.type === 'multi_choice_select' && m.metadata?.options?.length) {
        const optionLabels = m.metadata.options.map((o: any) => o.label).join(', ');
        content += ` [Options: ${optionLabels}]`;
      }
      // Include search answer if this was an intake search
      if (m.metadata?.type === 'intake_search' && m.metadata?.answer) {
        content += `\n\nSearch results:\n${m.metadata.answer.substring(0, 1500)}`;
      }
      messages.push({ role: 'assistant', content });
    }
  }

  // Add current message if not already there
  const lastMsg = conversationHistory[conversationHistory.length - 1];
  if (!(lastMsg?.role === 'user' && lastMsg?.content === userMessage)) {
    messages.push({ role: 'user', content: userMessage });
  }

  console.log('[Intake] ====== NEW REQUEST ======');
  console.log('[Intake] Messages:', JSON.stringify(messages, null, 2));

  // Phase 1: Call with all tools (including search)
  const result1 = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: INTAKE_INSTRUCTIONS,
    messages,
    tools: { search, textInput, multiChoiceSelect, startResearch },
    toolChoice: 'required'
  });

  // Check if search was called
  const searchCall = result1.toolCalls?.find((tc: any) => tc.toolName === 'search');

  if (searchCall) {
    // Debug: log the full structures
    console.log('[Intake] ======= SEARCH DEBUG =======');
    console.log('[Intake] searchCall keys:', Object.keys(searchCall));
    console.log('[Intake] searchCall.input:', JSON.stringify(searchCall.input, null, 2));
    console.log('[Intake] result1.toolResults:', JSON.stringify(result1.toolResults, null, 2)?.substring(0, 2000));

    // Extract query from input (Anthropic AI SDK uses .input for tool call arguments)
    const searchArgs = (searchCall.input || searchCall.args || {}) as any;
    const query = searchArgs?.queries?.[0]?.query || '';
    console.log('[Intake] Extracted query:', query);
    onProgress?.({ type: 'intake_searching', query });

    // Get search result - toolResults contains the executed tool results
    const searchResult = result1.toolResults?.find((tr: any) => tr.toolName === 'search') as any;
    console.log('[Intake] searchResult keys:', searchResult ? Object.keys(searchResult) : 'null');

    // The result structure: { toolCallId, toolName, output: { count, results: [{ query, answer, ... }], timestamp } }
    // Note: Anthropic SDK uses .output, not .result
    const toolOutput = searchResult?.output || searchResult?.result;
    console.log('[Intake] toolOutput keys:', toolOutput ? Object.keys(toolOutput) : 'null');
    console.log('[Intake] toolOutput.results[0]:', JSON.stringify(toolOutput?.results?.[0], null, 2)?.substring(0, 500));

    // Extract answer from the nested structure
    const answer = toolOutput?.results?.[0]?.answer || 'No results found';
    console.log('[Intake] Final answer length:', answer.length);
    console.log('[Intake] ======= END DEBUG =======');

    onProgress?.({ type: 'intake_search_complete', query, answer });

    // Phase 2: Call again with search results in context
    const messagesWithSearch = [
      ...messages,
      { role: 'assistant' as const, content: `[I searched for "${query}"]` },
      { role: 'user' as const, content: `Search results: ${answer.substring(0, 1000)}` }
    ];

    console.log('[Intake] Calling again with search results...');

    const result2 = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: INTAKE_INSTRUCTIONS,
      messages: messagesWithSearch,
      tools: { textInput, multiChoiceSelect, startResearch }, // No search this time
      toolChoice: 'required'
    });

    const decision = extractActionFromResult(result2);
    // Attach search info so it can be stored in conversation
    decision.searchPerformed = { query, answer };
    return decision;
  }

  // No search - check for action tool
  return extractActionFromResult(result1);
}

function extractActionFromResult(result: any): OrchestratorDecision {
  console.log('[Intake] ======= ACTION EXTRACTION =======');
  console.log('[Intake] All toolCalls:', JSON.stringify(result.toolCalls, null, 2));

  const actionCall = result.toolCalls?.find((tc: any) =>
    ['textInput', 'multiChoiceSelect', 'startResearch'].includes(tc.toolName)
  );

  console.log('[Intake] Found action:', actionCall?.toolName);

  if (!actionCall) {
    console.log('[Intake] No action tool found in toolCalls');
    return {
      type: 'text_input',
      message: 'What would you like me to research?',
      reasoning: 'No action tool called'
    };
  }

  console.log('[Intake] actionCall keys:', Object.keys(actionCall));
  console.log('[Intake] actionCall.input:', JSON.stringify(actionCall.input, null, 2));

  // Anthropic AI SDK uses .input for tool call arguments (not .args)
  const args = (actionCall.input || actionCall.args || {}) as any;
  console.log('[Intake] Final args:', JSON.stringify(args, null, 2));
  console.log('[Intake] ======= END ACTION =======');

  if (actionCall.toolName === 'startResearch') {
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

  if (actionCall.toolName === 'multiChoiceSelect') {
    return {
      type: 'multi_choice_select',
      message: args.message || 'Please select:',
      reasoning: 'Asking multi-choice question',
      reason: args.reason,
      options: args.options || []
    };
  }

  // textInput
  return {
    type: 'text_input',
    message: args.message || 'Please tell me more:',
    reasoning: 'Asking text question',
    reason: args.reason
  };
}
