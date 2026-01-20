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

export interface ResearchMemory {
  version: 1;
  objective: string;
  successCriteria?: string;
  cycles: ResearchCycle[];
  queriesRun: string[];     // Flat list for dedup
  legacyBrain?: string;     // Preserved markdown from old sessions
}
