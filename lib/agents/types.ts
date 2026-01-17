/**
 * Agent response types for structured output
 */

export type AgentActionType =
  | 'casual_response'    // Agent responds to casual conversation
  | 'thinking'           // Agent is planning research
  | 'searching'          // Agent is executing searches
  | 'synthesizing'       // Agent is creating final answer
  | 'asking_user'        // Agent needs user input

export type AgentDecision =
  | 'CONTINUE'           // Continue with more searches
  | 'SYNTHESIZE'         // Ready to create final answer
  | 'ASK'                // Need to ask user a question
  | 'COMPLETE'           // Research is complete

export interface AgentThinking {
  type: 'thinking';
  content: string;       // What the agent is thinking about
  nextSteps?: string[];  // Optional: planned next steps
}

export interface AgentCasualResponse {
  type: 'casual_response';
  content: string;       // Casual conversation response
}

export interface AgentSearchPlan {
  type: 'search_plan';
  queries: string[];     // List of 3-5 search queries to execute
  reasoning: string;     // Why these searches
}

export interface AgentQuestion {
  type: 'question';
  content: string;       // Question for the user
  context?: string;      // Why asking this question
}

export interface AgentDecisionBlock {
  type: 'decision';
  decision: AgentDecision;
  reasoning: string;     // Explanation of decision
  nextQueries?: string[]; // If CONTINUE, what queries to run next
}

export interface AgentSynthesis {
  type: 'synthesis';
  answer: string;        // Final comprehensive answer (markdown)
  sources: Array<{       // List of sources used
    title: string;
    url: string;
  }>;
}

export type AgentMessage =
  | AgentThinking
  | AgentCasualResponse
  | AgentSearchPlan
  | AgentQuestion
  | AgentDecisionBlock
  | AgentSynthesis;

/**
 * Parsed agent output
 */
export interface ParsedAgentOutput {
  messages: AgentMessage[];
  decision?: AgentDecision;
  shouldContinue: boolean;
  readyForSynthesis: boolean;
}

/**
 * Agent iteration result (what's returned from runAgentIteration)
 */
export interface AgentIterationResult {
  parsedOutput: ParsedAgentOutput;
  conversationHistory: any[];  // Anthropic message history
  creditsUsed: number;
  updatedDocument: string;     // Current document state
}

/**
 * Synthesis result
 */
export interface SynthesisResult {
  finalAnswer: string;         // Markdown formatted answer
  sources: Array<{
    title: string;
    url: string;
  }>;
  creditsUsed: number;
}
