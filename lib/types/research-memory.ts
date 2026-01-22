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

export interface ExplorationItem {
  item: string;
  done: boolean;
  doneWhen?: string;  // Criteria for when this is complete
  subtasks?: { item: string; done: boolean }[];
}

export interface ResearchMemory {
  version: 1;
  objective: string;
  explorationList?: ExplorationItem[];
  cycles: ResearchCycle[];
  queriesRun: string[];
}
