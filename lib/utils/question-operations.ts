/**
 * ResearchQuestion Operations - Utility functions for CortexDoc manipulation
 */

import {
  CortexDoc,
  CortexDocSchema,
  ResearchQuestion,
  CortexDecision,
  CortexAction,
  createResearchQuestion,
  createCortexDecision,
  createCortexDoc,
  generateFindingId,
} from '../types/research-question';
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

// ============================================================
// ResearchQuestion Operations
// ============================================================

/**
 * Add a new question to the document
 */
export function addResearchQuestion(
  doc: CortexDoc,
  name: string,
  description: string,
  goal: string,
  maxCycles: number = 10
): CortexDoc {
  const question = createResearchQuestion(name, description, goal, maxCycles);
  return {
    ...doc,
    questions: [...doc.questions, question],
  };
}

/**
 * Get an question by ID
 */
export function getResearchQuestion(doc: CortexDoc, questionId: string): ResearchQuestion | undefined {
  return doc.questions.find(i => i.id === questionId);
}

/**
 * Get all pending questions
 */
export function getPendingResearchQuestions(doc: CortexDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'pending');
}

/**
 * Get all running questions
 */
export function getRunningResearchQuestions(doc: CortexDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'running');
}

/**
 * Get all completed questions
 */
export function getCompletedResearchQuestions(doc: CortexDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'done');
}

/**
 * Update an question's status
 */
export function updateResearchQuestionStatus(
  doc: CortexDoc,
  questionId: string,
  status: ResearchQuestion['status']
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId ? { ...i, status } : i
    ),
  };
}

/**
 * Start an question (set status to running)
 */
export function startResearchQuestion(doc: CortexDoc, questionId: string): CortexDoc {
  return updateResearchQuestionStatus(doc, questionId, 'running');
}

/**
 * Complete an question with results
 */
export function completeResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  summary: string,
  confidence: ResearchQuestion['confidence'],
  recommendation: ResearchQuestion['recommendation']
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
        ? { ...i, status: 'done' as const, summary, confidence, recommendation }
        : i
    ),
  };
}

/**
 * Increment cycle count for an question
 */
export function incrementResearchQuestionCycle(doc: CortexDoc, questionId: string): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId ? { ...i, cycles: i.cycles + 1 } : i
    ),
  };
}

// ============================================================
// Finding Operations (within ResearchQuestions)
// ============================================================

/**
 * Add a finding to an question
 */
export function addFindingToResearchQuestion(
  doc: CortexDoc,
  questionId: string,
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
    questions: doc.questions.map(i =>
      i.id === questionId
        ? { ...i, findings: [...i.findings, finding] }
        : i
    ),
  };
}

/**
 * Edit a finding within an question
 */
export function editFindingInResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  findingId: string,
  content: string
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
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
 * Disqualify a finding within an question
 */
export function disqualifyFindingInResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  findingId: string,
  reason: string
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
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
 * Add full search result to question
 */
export function addSearchResultToResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  query: string,
  answer: string,
  sources: { url: string; title?: string }[] = [],
  reasoning?: string
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
        ? {
            ...i,
            searchResults: [...(i.searchResults || []), { query, answer, sources, reasoning }],
          }
        : i
    ),
  };
}

/**
 * Check if a query has been run in an question
 */
export function hasQueryBeenRunInResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  query: string
): boolean {
  const question = getResearchQuestion(doc, questionId);
  if (!question) return false;
  const normalized = query.toLowerCase().trim();
  return (question.searchResults || []).some(sr => sr.query.toLowerCase().trim() === normalized);
}

/**
 * Add a cycle reflection to an question
 */
export function addReflectionToResearchQuestion(
  doc: CortexDoc,
  questionId: string,
  cycle: number,
  learned: string,
  nextStep: string,
  status: 'continue' | 'done'
): CortexDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
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
  questionId?: string
): CortexDoc {
  const decision = createCortexDecision(action, reasoning, questionId);
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

  if (doc.questions.length > 0) {
    parts.push('\n## Research Angles');
    for (const init of doc.questions) {
      const statusIcon = init.status === 'done' ? '✓' : init.status === 'running' ? '→' : '○';
      parts.push(`\n### [${init.id}] ${statusIcon} ${init.name}`);
      parts.push(`**Description:** ${init.description}`);
      parts.push(`**Goal:** ${init.goal}`);
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

      if ((init.searchResults || []).length > 0) {
        parts.push(`\n**Searches:** ${init.searchResults.length}`);
      }
    }
  } else {
    parts.push('\n## ResearchQuestions');
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
 * Format question for agent context (single question view)
 */
export function formatResearchQuestionForAgent(question: ResearchQuestion): string {
  const parts: string[] = [];

  parts.push(`# ResearchQuestion: ${question.name}\n`);
  parts.push(`**ID:** ${question.id}`);
  parts.push(`**Description:** ${question.description}`);
  parts.push(`**Goal:** ${question.goal}`);
  parts.push(`**Status:** ${question.status}`);
  parts.push(`**Cycles:** ${question.cycles}/${question.maxCycles}`);

  if (question.confidence) parts.push(`**Confidence:** ${question.confidence}`);
  if (question.recommendation) parts.push(`**Recommendation:** ${question.recommendation}`);

  const activeFindings = question.findings.filter(f => f.status !== 'disqualified');
  const disqualifiedFindings = question.findings.filter(f => f.status === 'disqualified');

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

  const searches = question.searchResults || [];
  if (searches.length > 0) {
    parts.push('\n## Search Results');
    searches.forEach((sr, i) => {
      parts.push(`\n### Search ${i + 1}: ${sr.query}`);
      if (sr.answer) {
        parts.push(`**Answer:** ${sr.answer}`);
      }
      if (sr.learned) {
        parts.push(`**Learned:** ${sr.learned}`);
      }
      if (sr.nextAction) {
        parts.push(`**Next:** ${sr.nextAction}`);
      }
    });
  }

  const reflections = question.reflections || [];
  if (reflections.length > 0) {
    parts.push('\n## Previous Reflections');
    reflections.forEach(r => {
      parts.push(`- Cycle ${r.cycle}: ${r.learned} → ${r.nextStep}`);
    });
  }

  return parts.join('\n');
}

/**
 * Get summary of all questions
 */
export function getResearchQuestionsSummary(doc: CortexDoc): string {
  const parts: string[] = [];

  const pending = getPendingResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const done = getCompletedResearchQuestions(doc);

  parts.push(`**Research Angles:** ${done.length} done, ${running.length} running, ${pending.length} pending`);

  for (const init of doc.questions) {
    const statusIcon = init.status === 'done' ? '✓' : init.status === 'running' ? '→' : '○';
    const findingCount = init.findings.filter(f => f.status === 'active').length;
    parts.push(`- ${statusIcon} **${init.name}**: ${init.goal} (${findingCount} findings)`);
  }

  return parts.join('\n');
}

/**
 * Collect all findings across all questions
 */
export function getAllFindings(doc: CortexDoc): { questionId: string; finding: Finding }[] {
  const results: { questionId: string; finding: Finding }[] = [];
  for (const init of doc.questions) {
    for (const finding of init.findings) {
      results.push({ questionId: init.id, finding });
    }
  }
  return results;
}

/**
 * Collect all active findings across all questions
 */
export function getAllActiveFindings(doc: CortexDoc): { questionId: string; finding: Finding }[] {
  return getAllFindings(doc).filter(item => item.finding.status === 'active');
}
