/**
 * Document Operations - Version 8
 * Phased research with sequential steps
 */

import {
  ResearchDoc,
  ResearchDocSchema,
  ResearchPhase,
  Finding,
  Strategy,
  StrategyLogEntry,
  createInitialStrategyEntry,
  createStrategyEntry,
  createResearchPhase,
  generatePhaseId,
  generateFindingId,
} from '../types/research-doc';
import type { DocEdit, ReflectionOutput } from '../types/doc-edit';

/**
 * Initial phase definition from intake
 */
export interface InitialPhase {
  title: string;
  goal: string;
}

/**
 * Create a new research document
 */
export function createResearchDoc(
  objective: string,
  initialStrategy?: Strategy,
  initialPhases?: InitialPhase[]
): ResearchDoc {
  const initialEntry = initialStrategy
    ? createStrategyEntry(initialStrategy)
    : createInitialStrategyEntry(objective);

  // Create phases from initial phases, mark first as in_progress
  const phases = (initialPhases || []).map((p, idx) => ({
    ...createResearchPhase(p.title, p.goal),
    status: idx === 0 ? 'in_progress' as const : 'not_started' as const,
  }));

  return {
    version: 8,
    objective,
    phases,
    strategyLog: [initialEntry],
    queriesRun: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get the current (latest) strategy from the log
 */
export function getCurrentStrategy(doc: ResearchDoc): StrategyLogEntry | null {
  return doc.strategyLog.length > 0 ? doc.strategyLog[doc.strategyLog.length - 1] : null;
}

/**
 * Find a phase by ID
 */
export function findPhase(doc: ResearchDoc, phaseId: string): ResearchPhase | undefined {
  return doc.phases.find(p => p.id === phaseId);
}

/**
 * Find a phase index by ID
 */
export function findPhaseIndex(doc: ResearchDoc, phaseId: string): number {
  return doc.phases.findIndex(p => p.id === phaseId);
}

/**
 * Get the current active phase (first in_progress, or first not_started)
 */
export function getCurrentPhase(doc: ResearchDoc): ResearchPhase | null {
  const inProgress = doc.phases.find(p => p.status === 'in_progress');
  if (inProgress) return inProgress;

  const notStarted = doc.phases.find(p => p.status === 'not_started');
  return notStarted || null;
}

/**
 * Apply a single edit operation
 */
export function applyEdit(doc: ResearchDoc, edit: DocEdit): ResearchDoc {
  const now = new Date().toISOString();

  switch (edit.action) {
    case 'add_phase': {
      if (!edit.phaseTitle || !edit.phaseGoal) {
        console.warn('[applyEdit] add_phase requires phaseTitle and phaseGoal');
        return doc;
      }
      const newPhase = createResearchPhase(edit.phaseTitle, edit.phaseGoal);
      return {
        ...doc,
        phases: [...doc.phases, newPhase],
        lastUpdated: now,
      };
    }

    case 'start_phase': {
      if (!edit.phaseId) {
        console.warn('[applyEdit] start_phase requires phaseId');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) return doc;

      const newPhases = [...doc.phases];
      newPhases[pIdx] = { ...doc.phases[pIdx], status: 'in_progress' };
      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    case 'complete_phase': {
      if (!edit.phaseId) {
        console.warn('[applyEdit] complete_phase requires phaseId');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) return doc;

      const newPhases = [...doc.phases];
      newPhases[pIdx] = { ...doc.phases[pIdx], status: 'done' };

      // Auto-start next phase if exists
      const nextIdx = pIdx + 1;
      if (nextIdx < newPhases.length && newPhases[nextIdx].status === 'not_started') {
        newPhases[nextIdx] = { ...newPhases[nextIdx], status: 'in_progress' };
      }

      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    case 'add_finding': {
      if (!edit.phaseId) {
        console.warn('[applyEdit] add_finding requires phaseId');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) {
        console.warn(`[applyEdit] Phase "${edit.phaseId}" not found`);
        return doc;
      }
      const phase = doc.phases[pIdx];
      const newFinding: Finding = {
        id: generateFindingId(),
        content: edit.content || '',
        sources: edit.sources || [],
        status: 'active',
      };
      const newPhases = [...doc.phases];
      newPhases[pIdx] = {
        ...phase,
        findings: [...phase.findings, newFinding],
      };
      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    case 'edit_finding': {
      if (!edit.phaseId || !edit.findingId) {
        console.warn('[applyEdit] edit_finding requires phaseId and findingId');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) return doc;

      const phase = doc.phases[pIdx];
      const newFindings = phase.findings.map(f => {
        if (f.id === edit.findingId) {
          return {
            ...f,
            content: edit.content ?? f.content,
            sources: edit.sources ?? f.sources,
          };
        }
        return f;
      });

      const newPhases = [...doc.phases];
      newPhases[pIdx] = { ...phase, findings: newFindings };
      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    case 'remove_finding': {
      if (!edit.phaseId || !edit.findingId) {
        console.warn('[applyEdit] remove_finding requires phaseId and findingId');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) return doc;

      const phase = doc.phases[pIdx];
      const newFindings = phase.findings.filter(f => f.id !== edit.findingId);

      const newPhases = [...doc.phases];
      newPhases[pIdx] = { ...phase, findings: newFindings };
      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    case 'disqualify_finding': {
      if (!edit.phaseId || !edit.findingId) {
        console.warn('[applyEdit] disqualify_finding requires phaseId and findingId');
        return doc;
      }
      if (!edit.disqualifyReason) {
        console.warn('[applyEdit] disqualify_finding requires disqualifyReason');
        return doc;
      }
      const pIdx = findPhaseIndex(doc, edit.phaseId);
      if (pIdx === -1) return doc;

      const phase = doc.phases[pIdx];
      const newFindings = phase.findings.map(f => {
        if (f.id === edit.findingId) {
          return {
            ...f,
            status: 'disqualified' as const,
            disqualifyReason: edit.disqualifyReason,
          };
        }
        return f;
      });

      const newPhases = [...doc.phases];
      newPhases[pIdx] = { ...phase, findings: newFindings };
      return {
        ...doc,
        phases: newPhases,
        lastUpdated: now,
      };
    }

    default:
      return doc;
  }
}

/**
 * Apply multiple edits to the document
 */
export function applyEdits(doc: ResearchDoc, edits: DocEdit[]): ResearchDoc {
  return edits.reduce((currentDoc, edit) => applyEdit(currentDoc, edit), doc);
}

/**
 * Apply a reflection output to the document
 */
export function applyReflectionOutput(
  doc: ResearchDoc,
  output: ReflectionOutput
): ResearchDoc {
  let newDoc = applyEdits(doc, output.edits);

  if (output.strategyUpdate) {
    const newEntry = createStrategyEntry(output.strategyUpdate);
    newDoc = {
      ...newDoc,
      strategyLog: [...newDoc.strategyLog, newEntry],
      lastUpdated: new Date().toISOString(),
    };
  }

  return newDoc;
}

/**
 * Append a new strategy to the log
 */
export function appendStrategy(doc: ResearchDoc, strategy: Strategy): ResearchDoc {
  const newEntry = createStrategyEntry(strategy);
  return {
    ...doc,
    strategyLog: [...doc.strategyLog, newEntry],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Add a new research phase
 */
export function addResearchPhase(doc: ResearchDoc, title: string, goal: string): ResearchDoc {
  const phase = createResearchPhase(title, goal);
  return {
    ...doc,
    phases: [...doc.phases, phase],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Add queries to dedup list
 */
export function addQueriesToDoc(doc: ResearchDoc, queries: string[]): ResearchDoc {
  const newQueries = queries.filter(q => !doc.queriesRun.includes(q));
  if (newQueries.length === 0) return doc;

  return {
    ...doc,
    queriesRun: [...doc.queriesRun, ...newQueries],
  };
}

/**
 * Check if a query has been run
 */
export function hasQueryBeenRun(doc: ResearchDoc, query: string): boolean {
  const normalized = query.toLowerCase().trim();
  return doc.queriesRun.some(q => q.toLowerCase().trim() === normalized);
}

/**
 * Format document for agent context
 */
export function formatDocForAgent(doc: ResearchDoc): string {
  const parts: string[] = [];
  const currentStrategy = getCurrentStrategy(doc);

  parts.push('# Research Document\n');
  parts.push(`**Objective:** ${doc.objective}`);

  if (currentStrategy) {
    parts.push('\n## Current Strategy');
    parts.push(`**Approach:** ${currentStrategy.approach}`);
    if (currentStrategy.nextActions.length > 0) {
      parts.push(`**Next:** ${currentStrategy.nextActions[0]}`);
    }
  }

  // Research Phases
  if (doc.phases.length > 0) {
    parts.push('\n## Research Plan');
    for (const phase of doc.phases) {
      const statusIcon = phase.status === 'done' ? '✓' : phase.status === 'in_progress' ? '→' : '○';
      parts.push(`\n### [${phase.id}] ${statusIcon} ${phase.title}`);
      parts.push(`Goal: ${phase.goal}`);

      const activeFindings = phase.findings.filter(f => f.status !== 'disqualified');
      const disqualifiedFindings = phase.findings.filter(f => f.status === 'disqualified');

      if (activeFindings.length === 0 && disqualifiedFindings.length === 0) {
        if (phase.status === 'in_progress') {
          parts.push('(researching...)');
        } else if (phase.status === 'not_started') {
          parts.push('(not started)');
        }
      } else {
        for (const finding of activeFindings) {
          parts.push(`- [${finding.id}] ${finding.content}`);
          if (finding.sources.length > 0) {
            const sourceList = finding.sources.map(s => s.title).join(', ');
            parts.push(`  Sources: ${sourceList}`);
          }
        }
        for (const finding of disqualifiedFindings) {
          parts.push(`- [${finding.id}] ~~${finding.content}~~ (${finding.disqualifyReason})`);
        }
      }
    }
  } else {
    parts.push('\n## Research Plan');
    parts.push('(no phases defined)');
  }

  parts.push(`\n---`);
  parts.push(`**Queries Run:** ${doc.queriesRun.length}`);

  return parts.join('\n');
}

/**
 * Get a summary of the document
 */
export function getDocSummary(doc: ResearchDoc): string {
  const parts: string[] = [];
  const currentStrategy = getCurrentStrategy(doc);

  parts.push(`**Objective:** ${doc.objective}`);

  const donePhases = doc.phases.filter(p => p.status === 'done');
  const inProgressPhases = doc.phases.filter(p => p.status === 'in_progress');
  const notStartedPhases = doc.phases.filter(p => p.status === 'not_started');

  parts.push(`\n**Phases:** ${donePhases.length} done, ${inProgressPhases.length} in progress, ${notStartedPhases.length} remaining`);

  if (currentStrategy) {
    parts.push(`\n**Strategy:** ${currentStrategy.approach}`);
  }

  return parts.join('\n');
}

/**
 * Serialize document to JSON
 */
export function serializeDoc(doc: ResearchDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse document from JSON
 */
export function parseDoc(json: string): ResearchDoc | null {
  if (!json?.trim()) return null;

  try {
    const parsed = JSON.parse(json.trim());
    const result = ResearchDocSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn('[parseDoc] Validation failed:', result.error.issues);
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Parse brain content to document
 */
export function parseBrainToDoc(brain: string): ResearchDoc | null {
  return parseDoc(brain);
}
