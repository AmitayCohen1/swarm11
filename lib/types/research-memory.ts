/**
 * Research Memory Types
 * Structured JSON format for tracking full research cycles
 */

export interface SearchResult {
  query: string;
  purpose: string;
  answer: string;
  sources: { url: string; title: string }[];
}

export interface ResearchCycle {
  timestamp: string;
  intent: string;           // Why we're searching
  searches: SearchResult[];
  learned: string;          // Freeform - what we learned
  nextStep: string;         // Freeform - what to do next
}

export interface ResearchAngle {
  name: string;           // Short name: "Platforms", "Newsrooms", etc.
  goal: string;           // What we're looking for via this angle
  stopWhen: string;       // When to stop: success criteria OR rejection criteria
  status: 'active' | 'worked' | 'rejected';
  result?: string;        // Brief summary of what happened
}

export interface ResearchMemory {
  version: 1;
  objective: string;
  angles?: ResearchAngle[];  // Fixed set of strategies to try
  cycles: ResearchCycle[];
  queriesRun: string[];
}
