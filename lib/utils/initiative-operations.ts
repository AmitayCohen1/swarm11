/**
 * Initiative Operations - Utility functions for CortexDoc manipulation
 */

import {
  CortexDoc,
  CortexDocSchema,
  Initiative,
  CortexDecision,
  CortexAction,
  createInitiative,
  createCortexDecision,
  createCortexDoc,
  generateFindingId,
} from '../types/initiative-doc';
import type { Finding, Source } from '../types/research-doc';

// ============================================================
// Document Creation & Parsing
// ============================================================

/**
 * Initialize a new CortexDoc from research brief
 */
export function initializeCortexDoc(
  objective: string,
  successCriteria: string[]
): CortexDoc {
  return createCortexDoc(objective, successCriteria);
}

/**
 * Serialize CortexDoc to JSON string
 */
export function serializeCortexDoc(doc: CortexDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse JSON string to CortexDoc
 */
export function parseCortexDoc(json: string): CortexDoc | null {
  if (!json?.trim()) return null;

  try {
    const parsed = JSON.parse(json.trim());
    const result = CortexDocSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn('[parseCortexDoc] Validation failed:', result.error.issues);
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Parse brain content to CortexDoc
 */
export function parseBrainToCortexDoc(brain: string): CortexDoc | null {
  return parseCortexDoc(brain);
}

// ============================================================
// Initiative Operations
// ============================================================

/**
 * Add a new initiative to the document
 */
export function addInitiative(
  doc: CortexDoc,
  angle: string,
  rationale: string,
  question: string,
  maxCycles: number = 5
): CortexDoc {
  const initiative = createInitiative(angle, rationale, question, maxCycles);
  return {
    ...doc,
    initiatives: [...doc.initiatives, initiative],
  };
}

/**
 * Get an initiative by ID
 */
export function getInitiative(doc: CortexDoc, initiativeId: string): Initiative | undefined {
  return doc.initiatives.find(i => i.id === initiativeId);
}

/**
 * Get all pending initiatives
 */
export function getPendingInitiatives(doc: CortexDoc): Initiative[] {
  return doc.initiatives.filter(i => i.status === 'pending');
}

/**
 * Get all running initiatives
 */
export function getRunningInitiatives(doc: CortexDoc): Initiative[] {
  return doc.initiatives.filter(i => i.status === 'running');
}

/**
 * Get all completed initiatives
 */
export function getCompletedInitiatives(doc: CortexDoc): Initiative[] {
  return doc.initiatives.filter(i => i.status === 'done');
}

/**
 * Update an initiative's status
 */
export function updateInitiativeStatus(
  doc: CortexDoc,
  initiativeId: string,
  status: Initiative['status']
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId ? { ...i, status } : i
    ),
  };
}

/**
 * Start an initiative (set status to running)
 */
export function startInitiative(doc: CortexDoc, initiativeId: string): CortexDoc {
  return updateInitiativeStatus(doc, initiativeId, 'running');
}

/**
 * Complete an initiative with results
 */
export function completeInitiative(
  doc: CortexDoc,
  initiativeId: string,
  summary: string,
  confidence: Initiative['confidence'],
  recommendation: Initiative['recommendation']
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? { ...i, status: 'done' as const, summary, confidence, recommendation }
        : i
    ),
  };
}

/**
 * Increment cycle count for an initiative
 */
export function incrementInitiativeCycle(doc: CortexDoc, initiativeId: string): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId ? { ...i, cycles: i.cycles + 1 } : i
    ),
  };
}

// ============================================================
// Finding Operations (within Initiatives)
// ============================================================

/**
 * Add a finding to an initiative
 */
export function addFindingToInitiative(
  doc: CortexDoc,
  initiativeId: string,
  content: string,
  sources: Source[] = []
): CortexDoc {
  const finding: Finding = {
    id: generateFindingId(),
    content,
    sources,
    status: 'active',
  };

  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? { ...i, findings: [...i.findings, finding] }
        : i
    ),
  };
}

/**
 * Edit a finding within an initiative
 */
export function editFindingInInitiative(
  doc: CortexDoc,
  initiativeId: string,
  findingId: string,
  content: string
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? {
            ...i,
            findings: i.findings.map(f =>
              f.id === findingId ? { ...f, content } : f
            ),
          }
        : i
    ),
  };
}

/**
 * Disqualify a finding within an initiative
 */
export function disqualifyFindingInInitiative(
  doc: CortexDoc,
  initiativeId: string,
  findingId: string,
  reason: string
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? {
            ...i,
            findings: i.findings.map(f =>
              f.id === findingId
                ? { ...f, status: 'disqualified' as const, disqualifyReason: reason }
                : f
            ),
          }
        : i
    ),
  };
}

/**
 * Add query to initiative's queriesRun list
 */
export function addQueryToInitiative(
  doc: CortexDoc,
  initiativeId: string,
  query: string
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId && !i.queriesRun.includes(query)
        ? { ...i, queriesRun: [...i.queriesRun, query] }
        : i
    ),
  };
}

/**
 * Add full search result to initiative
 */
export function addSearchResultToInitiative(
  doc: CortexDoc,
  initiativeId: string,
  query: string,
  answer: string,
  sources: { url: string; title?: string }[] = []
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? {
            ...i,
            queriesRun: i.queriesRun.includes(query) ? i.queriesRun : [...i.queriesRun, query],
            searchResults: [...(i.searchResults || []), { query, answer, sources }],
          }
        : i
    ),
  };
}

/**
 * Check if a query has been run in an initiative
 */
export function hasQueryBeenRunInInitiative(
  doc: CortexDoc,
  initiativeId: string,
  query: string
): boolean {
  const initiative = getInitiative(doc, initiativeId);
  if (!initiative) return false;
  const normalized = query.toLowerCase().trim();
  return initiative.queriesRun.some(q => q.toLowerCase().trim() === normalized);
}

/**
 * Add a cycle reflection to an initiative
 */
export function addReflectionToInitiative(
  doc: CortexDoc,
  initiativeId: string,
  cycle: number,
  learned: string,
  nextStep: string,
  status: 'continue' | 'done'
): CortexDoc {
  return {
    ...doc,
    initiatives: doc.initiatives.map(i =>
      i.id === initiativeId
        ? {
            ...i,
            reflections: [...(i.reflections || []), { cycle, learned, nextStep, status }],
          }
        : i
    ),
  };
}

// ============================================================
// Cortex Decision Log
// ============================================================

/**
 * Add a cortex decision to the log
 */
export function addCortexDecision(
  doc: CortexDoc,
  action: CortexAction,
  reasoning: string,
  initiativeId?: string
): CortexDoc {
  const decision = createCortexDecision(action, reasoning, initiativeId);
  return {
    ...doc,
    cortexLog: [...doc.cortexLog, decision],
  };
}

/**
 * Get the last cortex decision
 */
export function getLastCortexDecision(doc: CortexDoc): CortexDecision | null {
  return doc.cortexLog.length > 0 ? doc.cortexLog[doc.cortexLog.length - 1] : null;
}

// ============================================================
// Document Status
// ============================================================

/**
 * Set document status
 */
export function setDocStatus(doc: CortexDoc, status: CortexDoc['status']): CortexDoc {
  return { ...doc, status };
}

/**
 * Set final answer
 */
export function setFinalAnswer(doc: CortexDoc, finalAnswer: string): CortexDoc {
  return { ...doc, finalAnswer, status: 'complete' };
}

// ============================================================
// Formatting for Agent Context
// ============================================================

/**
 * Format CortexDoc for agent context
 */
export function formatCortexDocForAgent(doc: CortexDoc): string {
  const parts: string[] = [];

  parts.push('# Cortex Research Document\n');
  parts.push(`**Objective:** ${doc.objective}`);
  parts.push(`**Status:** ${doc.status}`);

  if (doc.successCriteria.length > 0) {
    parts.push('\n## Success Criteria');
    doc.successCriteria.forEach((c, i) => parts.push(`${i + 1}. ${c}`));
  }

  if (doc.initiatives.length > 0) {
    parts.push('\n## Research Angles');
    for (const init of doc.initiatives) {
      const statusIcon = init.status === 'done' ? '✓' : init.status === 'running' ? '→' : '○';
      parts.push(`\n### [${init.id}] ${statusIcon} ${init.angle}`);
      parts.push(`**Rationale:** ${init.rationale}`);
      parts.push(`**Question:** ${init.question}`);
      parts.push(`**Cycles:** ${init.cycles}/${init.maxCycles}`);

      if (init.confidence) parts.push(`**Confidence:** ${init.confidence}`);
      if (init.recommendation) parts.push(`**Recommendation:** ${init.recommendation}`);
      if (init.summary) parts.push(`**Summary:** ${init.summary}`);

      const activeFindings = init.findings.filter(f => f.status !== 'disqualified');
      const disqualifiedFindings = init.findings.filter(f => f.status === 'disqualified');

      if (activeFindings.length > 0 || disqualifiedFindings.length > 0) {
        parts.push('\n**Findings:**');
        for (const finding of activeFindings) {
          parts.push(`- [${finding.id}] ${finding.content}`);
        }
        for (const finding of disqualifiedFindings) {
          parts.push(`- [${finding.id}] ~~${finding.content}~~ (${finding.disqualifyReason})`);
        }
      } else if (init.status === 'running') {
        parts.push('(researching...)');
      }

      if (init.queriesRun.length > 0) {
        parts.push(`\n**Queries Run:** ${init.queriesRun.length}`);
      }
    }
  } else {
    parts.push('\n## Initiatives');
    parts.push('(none yet)');
  }

  if (doc.cortexLog.length > 0) {
    parts.push('\n## Decision Log (Recent)');
    const recentDecisions = doc.cortexLog.slice(-5);
    for (const decision of recentDecisions) {
      parts.push(`- [${decision.action}] ${decision.reasoning.substring(0, 100)}${decision.reasoning.length > 100 ? '...' : ''}`);
    }
  }

  return parts.join('\n');
}

/**
 * Format initiative for agent context (single initiative view)
 */
export function formatInitiativeForAgent(initiative: Initiative): string {
  const parts: string[] = [];

  parts.push(`# Research Angle: ${initiative.angle}\n`);
  parts.push(`**ID:** ${initiative.id}`);
  parts.push(`**Rationale:** ${initiative.rationale}`);
  parts.push(`**Question:** ${initiative.question}`);
  parts.push(`**Status:** ${initiative.status}`);
  parts.push(`**Cycles:** ${initiative.cycles}/${initiative.maxCycles}`);

  if (initiative.confidence) parts.push(`**Confidence:** ${initiative.confidence}`);
  if (initiative.recommendation) parts.push(`**Recommendation:** ${initiative.recommendation}`);

  const activeFindings = initiative.findings.filter(f => f.status !== 'disqualified');
  const disqualifiedFindings = initiative.findings.filter(f => f.status === 'disqualified');

  if (activeFindings.length > 0 || disqualifiedFindings.length > 0) {
    parts.push('\n## Findings');
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
  } else {
    parts.push('\n## Findings');
    parts.push('(none yet)');
  }

  if (initiative.queriesRun.length > 0) {
    parts.push('\n## Queries Run');
    const recentQueries = initiative.queriesRun.slice(-10);
    recentQueries.forEach(q => parts.push(`- ${q}`));
    if (initiative.queriesRun.length > 10) {
      parts.push(`... and ${initiative.queriesRun.length - 10} more`);
    }
  }

  return parts.join('\n');
}

/**
 * Get summary of all initiatives
 */
export function getInitiativesSummary(doc: CortexDoc): string {
  const parts: string[] = [];

  const pending = getPendingInitiatives(doc);
  const running = getRunningInitiatives(doc);
  const done = getCompletedInitiatives(doc);

  parts.push(`**Research Angles:** ${done.length} done, ${running.length} running, ${pending.length} pending`);

  for (const init of doc.initiatives) {
    const statusIcon = init.status === 'done' ? '✓' : init.status === 'running' ? '→' : '○';
    const findingCount = init.findings.filter(f => f.status === 'active').length;
    parts.push(`- ${statusIcon} **${init.angle}**: ${init.question} (${findingCount} findings)`);
  }

  return parts.join('\n');
}

/**
 * Collect all findings across all initiatives
 */
export function getAllFindings(doc: CortexDoc): { initiativeId: string; finding: Finding }[] {
  const results: { initiativeId: string; finding: Finding }[] = [];
  for (const init of doc.initiatives) {
    for (const finding of init.findings) {
      results.push({ initiativeId: init.id, finding });
    }
  }
  return results;
}

/**
 * Collect all active findings across all initiatives
 */
export function getAllActiveFindings(doc: CortexDoc): { initiativeId: string; finding: Finding }[] {
  return getAllFindings(doc).filter(item => item.finding.status === 'active');
}
