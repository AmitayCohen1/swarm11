/**
 * Research Memory Types - Version 2
 * Append-only log architecture: persist understanding, not planning.
 */

export interface SearchResult {
  query: string;
  purpose: string;
  answer: string;
  sources: { url: string; title: string }[];
}

/**
 * Working Memory - Compressed conclusions (5-10 bullets)
 * Overwrites itself - not append-only like the log.
 * Contains "what we know" not "what we tried".
 */
export interface WorkingMemory {
  bullets: string[];      // 5-10 conclusions - what we know so far
  lastUpdated: string;    // ISO timestamp of last update
}

/**
 * Log Entry - Answers four questions after each search iteration
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  method: string;                  // What I tried THIS STEP (ephemeral, not a plan)
  signal: string;                  // What I observed
  insight: string;                 // What I learned
  progressTowardObjective: string; // MUST explicitly reference DONE_WHEN
  mood: 'exploring' | 'promising' | 'dead_end' | 'breakthrough'; // How this iteration went
  sources: { url: string; title: string }[];
}

/**
 * Research Memory v2 - Simplified structure
 * Fixed goal, flexible methods, cumulative insight
 */
export interface ResearchMemory {
  version: 2;
  objective: string;      // The core question (rarely changes)
  doneWhen: string;       // The stopping condition (hard gate)
  workingMemory: WorkingMemory; // Compressed conclusions (overwrites, not appends)
  log: LogEntry[];        // Append-only research log
  queriesRun: string[];   // For deduplication
}

// Legacy types for migration (v1)
export interface ResearchMemoryV1 {
  version: 1;
  objective: string;
  angles?: {
    name: string;
    goal: string;
    stopWhen: string;
    status: 'active' | 'worked' | 'rejected';
    result?: string;
  }[];
  cycles: {
    timestamp: string;
    intent: string;
    searches: SearchResult[];
    learned: string;
    nextStep: string;
  }[];
  queriesRun: string[];
}
