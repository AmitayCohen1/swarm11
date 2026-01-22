/**
 * Research Memory Utilities - Version 2
 * Append-only log architecture helper functions
 */

import type { ResearchMemory, LogEntry, ResearchMemoryV1, WorkingMemory } from '../types/research-memory';

/**
 * Parse brain content from JSON, handling v1 → v2 migration
 * Also ensures workingMemory exists for v2 memories that predate this field
 */
export function parseResearchMemory(brain: string): ResearchMemory | null {
  if (!brain || !brain.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(brain.trim());

    // Handle v2
    if (parsed.version === 2 && parsed.objective) {
      // Ensure workingMemory exists (backward compat for pre-workingMemory v2)
      if (!parsed.workingMemory) {
        parsed.workingMemory = {
          bullets: [],
          lastUpdated: new Date().toISOString()
        };
      }
      return parsed as ResearchMemory;
    }

    // Migrate v1 to v2
    if (parsed.version === 1 && parsed.objective) {
      return migrateV1toV2(parsed as ResearchMemoryV1);
    }
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Migrate v1 memory to v2 format
 */
export function migrateV1toV2(v1: ResearchMemoryV1): ResearchMemory {
  const log: LogEntry[] = [];

  // Convert cycles to log entries
  for (const cycle of v1.cycles || []) {
    if (cycle.learned) {
      log.push({
        id: `migrated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: cycle.timestamp,
        method: cycle.intent || 'Migrated from v1',
        signal: cycle.searches?.map(s => s.answer).join(' | ') || '',
        insight: cycle.learned,
        progressTowardObjective: cycle.nextStep || 'Migrated from v1',
        mood: 'exploring',
        sources: cycle.searches?.flatMap(s => s.sources) || []
      });
    }
  }

  // Derive doneWhen from angles if present
  const doneWhen = v1.angles?.map(a => a.stopWhen).join(' OR ') || 'Task completed';

  return {
    version: 2,
    objective: v1.objective,
    doneWhen,
    workingMemory: {
      bullets: [],
      lastUpdated: new Date().toISOString()
    },
    log,
    queriesRun: v1.queriesRun || []
  };
}

/**
 * Serialize research memory to JSON string for storage
 */
export function serializeResearchMemory(memory: ResearchMemory): string {
  return JSON.stringify(memory, null, 2);
}

/**
 * Create a new research memory with objective and doneWhen
 */
export function createResearchMemory(objective: string, doneWhen: string): ResearchMemory {
  return {
    version: 2,
    objective,
    doneWhen,
    workingMemory: {
      bullets: [],
      lastUpdated: new Date().toISOString()
    },
    log: [],
    queriesRun: []
  };
}

/**
 * Append a log entry to memory (immutable)
 */
export function appendLogEntry(memory: ResearchMemory, entry: Omit<LogEntry, 'id' | 'timestamp'>): ResearchMemory {
  const newEntry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...entry
  };

  return {
    ...memory,
    log: [...memory.log, newEntry]
  };
}

/**
 * Add a query to the dedup list
 */
export function addQueryToMemory(memory: ResearchMemory, query: string): ResearchMemory {
  if (memory.queriesRun.includes(query)) {
    return memory;
  }

  return {
    ...memory,
    queriesRun: [...memory.queriesRun, query]
  };
}

/**
 * Check if a query has already been run (for deduplication)
 */
export function hasQueryBeenRun(memory: ResearchMemory, query: string): boolean {
  const normalizedQuery = query.toLowerCase().trim();
  return memory.queriesRun.some(q => q.toLowerCase().trim() === normalizedQuery);
}

/**
 * Update working memory with new bullets (replaces existing)
 * Working memory is "what we know" - conclusions, not actions.
 * Limited to 10 bullets max.
 */
export function updateWorkingMemory(memory: ResearchMemory, bullets: string[]): ResearchMemory {
  return {
    ...memory,
    workingMemory: {
      bullets: bullets.slice(0, 10), // Enforce max 10 bullets
      lastUpdated: new Date().toISOString()
    }
  };
}

/**
 * Format log for agent context - working memory first, then recent log entries
 * Working memory is the primary context; full log is for reference only.
 */
export function formatLogForAgent(memory: ResearchMemory, maxEntries: number = 10): string {
  const parts: string[] = [];

  parts.push(`**OBJECTIVE:** ${memory.objective}`);
  parts.push(`**DONE_WHEN:** ${memory.doneWhen}`);

  // Working memory - the narrative of the research journey (read this first!)
  if (memory.workingMemory?.bullets?.length > 0) {
    const lastUpdated = memory.workingMemory.lastUpdated
      ? formatTimeAgo(new Date(memory.workingMemory.lastUpdated))
      : 'unknown';
    parts.push(`\n**THE STORY SO FAR** (updated ${lastUpdated}):`);
    for (const bullet of memory.workingMemory.bullets) {
      parts.push(`- ${bullet}`);
    }
  } else {
    parts.push('\n**THE STORY SO FAR:** (empty - research just starting)');
  }

  parts.push(`\n**Queries run:** ${memory.queriesRun.length}`);

  if (memory.log.length === 0) {
    parts.push('\n**Research Log:** (empty - no iterations yet)');
    return parts.join('\n');
  }

  parts.push(`\n**Research Log:** (${memory.log.length} entries)`);

  // Show recent entries (for reference, not primary context)
  const recentEntries = memory.log.slice(-maxEntries);
  const skipped = memory.log.length - recentEntries.length;

  if (skipped > 0) {
    parts.push(`... (${skipped} earlier entries omitted)`);
  }

  for (const entry of recentEntries) {
    const time = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    parts.push(`\n[${time}] **${entry.method}**`);
    parts.push(`  Signal: ${entry.signal.substring(0, 200)}${entry.signal.length > 200 ? '...' : ''}`);
    parts.push(`  Insight: ${entry.insight}`);
    parts.push(`  Progress: ${entry.progressTowardObjective}`);
  }

  return parts.join('\n');
}

/**
 * Format a time difference as human-readable "X ago" string
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

/**
 * Summarize log for context compression
 */
export function summarizeLog(memory: ResearchMemory): string {
  if (memory.log.length === 0) {
    return 'No research conducted yet.';
  }

  const insights = memory.log.map(e => e.insight).filter(Boolean);
  const methods = [...new Set(memory.log.map(e => e.method))];
  const lastProgress = memory.log[memory.log.length - 1]?.progressTowardObjective;

  return [
    `**Methods tried (${methods.length}):** ${methods.join(', ')}`,
    `**Key insights (${insights.length}):**`,
    ...insights.slice(-5).map(i => `- ${i}`),
    `**Latest progress:** ${lastProgress || 'Unknown'}`
  ].join('\n');
}

/**
 * Format research memory for orchestrator context (structured summary)
 * Working memory is the primary summary; includes recent insights for context
 */
export function formatForOrchestrator(memory: ResearchMemory | null, maxChars: number = 1500): string {
  if (!memory) {
    return '';
  }

  const parts: string[] = [];

  parts.push(`**Objective:** ${memory.objective}`);
  parts.push(`**Done when:** ${memory.doneWhen}`);

  // Working memory first - the research narrative
  if (memory.workingMemory?.bullets?.length > 0) {
    parts.push('\n**The story so far:**');
    for (const bullet of memory.workingMemory.bullets) {
      parts.push(`- ${bullet}`);
    }
  }

  if (memory.log.length > 0) {
    parts.push(`\n**Research Log:** ${memory.log.length} entries`);
    parts.push(`**Queries Run:** ${memory.queriesRun.length}`);

    // Show last 3 entries' insights
    const recentEntries = memory.log.slice(-3);
    parts.push('\n**Recent Insights:**');

    for (const entry of recentEntries) {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      parts.push(`- [${timestamp}] ${entry.insight}`);
    }

    // Show last progress assessment
    const lastEntry = memory.log[memory.log.length - 1];
    if (lastEntry) {
      parts.push(`\n**Latest Progress:** ${lastEntry.progressTowardObjective}`);
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
