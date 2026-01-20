/**
 * Research Memory Utilities
 * Helper functions for managing structured research memory
 */

import type { ResearchMemory, ResearchCycle, SearchResult } from '../types/research-memory';

/**
 * Parse brain content - handles both legacy markdown and new JSON format
 */
export function parseResearchMemory(brain: string): ResearchMemory | null {
  if (!brain || !brain.trim()) {
    return null;
  }

  // Try parsing as JSON first
  const trimmed = brain.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.version === 1 && parsed.objective) {
        return parsed as ResearchMemory;
      }
    } catch {
      // Not valid JSON, fall through to legacy handling
    }
  }

  // Legacy markdown format - wrap it
  return {
    version: 1,
    objective: 'Legacy research session',
    cycles: [],
    queriesRun: [],
    legacyBrain: brain
  };
}

/**
 * Serialize research memory to JSON string for storage
 */
export function serializeResearchMemory(memory: ResearchMemory): string {
  return JSON.stringify(memory, null, 2);
}

/**
 * Create a new research memory with objective and optional success criteria
 */
export function createResearchMemory(objective: string, successCriteria?: string): ResearchMemory {
  return {
    version: 1,
    objective,
    successCriteria,
    cycles: [],
    queriesRun: []
  };
}

/**
 * Start a new research cycle with an intent
 */
export function startCycle(memory: ResearchMemory, intent: string): ResearchMemory {
  const newCycle: ResearchCycle = {
    timestamp: new Date().toISOString(),
    intent,
    searches: [],
    learned: '',
    nextStep: ''
  };

  return {
    ...memory,
    cycles: [...memory.cycles, newCycle]
  };
}

/**
 * Add a search result to the current (last) cycle
 */
export function addSearchToMemory(memory: ResearchMemory, search: SearchResult): ResearchMemory {
  if (memory.cycles.length === 0) {
    // Auto-start a cycle if none exists
    memory = startCycle(memory, 'Initial exploration');
  }

  const cycles = [...memory.cycles];
  const currentCycle = { ...cycles[cycles.length - 1] };
  currentCycle.searches = [...currentCycle.searches, search];
  cycles[cycles.length - 1] = currentCycle;

  // Add query to flat list for dedup
  const queriesRun = [...memory.queriesRun];
  if (!queriesRun.includes(search.query)) {
    queriesRun.push(search.query);
  }

  return {
    ...memory,
    cycles,
    queriesRun
  };
}

/**
 * Complete the current cycle with learnings and next step
 */
export function completeCycle(memory: ResearchMemory, learned: string, nextStep: string): ResearchMemory {
  if (memory.cycles.length === 0) {
    return memory;
  }

  const cycles = [...memory.cycles];
  const currentCycle = { ...cycles[cycles.length - 1] };
  currentCycle.learned = learned;
  currentCycle.nextStep = nextStep;
  cycles[cycles.length - 1] = currentCycle;

  return {
    ...memory,
    cycles
  };
}

/**
 * Check if a query has already been run (for deduplication)
 */
export function hasQueryBeenRun(memory: ResearchMemory, query: string): boolean {
  // Normalize query for comparison
  const normalizedQuery = query.toLowerCase().trim();
  return memory.queriesRun.some(q => q.toLowerCase().trim() === normalizedQuery);
}

/**
 * Format research memory for orchestrator context (structured summary)
 */
export function formatForOrchestrator(memory: ResearchMemory | null, maxChars: number = 1500): string {
  if (!memory) {
    return '';
  }

  const parts: string[] = [];

  // Objective
  parts.push(`**Objective:** ${memory.objective}`);

  if (memory.successCriteria) {
    parts.push(`**Success Criteria:** ${memory.successCriteria}`);
  }

  // Legacy brain content (if present)
  if (memory.legacyBrain) {
    parts.push(`\n**Previous Research:**\n${memory.legacyBrain.substring(0, maxChars / 2)}`);
  }

  // Recent cycles summary
  if (memory.cycles.length > 0) {
    parts.push(`\n**Research Cycles:** ${memory.cycles.length}`);
    parts.push(`**Queries Run:** ${memory.queriesRun.length}`);

    // Show last 2-3 cycles' learnings
    const recentCycles = memory.cycles.slice(-3);
    parts.push('\n**Recent Learnings:**');

    for (const cycle of recentCycles) {
      if (cycle.learned) {
        const timestamp = new Date(cycle.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
        parts.push(`- [${timestamp}] ${cycle.learned}`);
      }
    }

    // Show last cycle's next step if research is ongoing
    const lastCycle = memory.cycles[memory.cycles.length - 1];
    if (lastCycle.nextStep && lastCycle.nextStep !== 'stop') {
      parts.push(`\n**Next Step:** ${lastCycle.nextStep}`);
    }
  }

  const result = parts.join('\n');

  // Truncate if needed
  if (result.length > maxChars) {
    return result.substring(0, maxChars - 3) + '...';
  }

  return result;
}

/**
 * Get all queries that have been run (for display/debugging)
 */
export function getAllQueries(memory: ResearchMemory): string[] {
  return [...memory.queriesRun];
}

/**
 * Get the current cycle's search count
 */
export function getCurrentCycleSearchCount(memory: ResearchMemory): number {
  if (memory.cycles.length === 0) {
    return 0;
  }
  return memory.cycles[memory.cycles.length - 1].searches.length;
}
