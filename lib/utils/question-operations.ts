/**
 * ResearchQuestion Operations - Utility functions for BrainDoc manipulation
 */

import {
  BrainDoc,
  BrainDocSchema,
  ResearchQuestion,
  BrainDecision,
  BrainAction,
  Episode,
  generateEpisodeId,
  createResearchQuestion,
  createBrainDecision,
  createBrainDoc,
  generateFindingId,
} from '../types/research-question';
import type { Finding, Source } from '../types/research-doc';

// ============================================================
// Document Creation & Parsing
// ============================================================

/**
 * Initialize a new BrainDoc from research brief
 */
export function initializeBrainDoc(
  objective: string,
  successCriteria: string[]
): BrainDoc {
  return createBrainDoc(objective, successCriteria);
}

/**
 * Serialize BrainDoc to JSON string
 */
export function serializeBrainDoc(doc: BrainDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse JSON string to BrainDoc
 */
export function parseBrainDoc(json: string): BrainDoc | null {
  if (!json?.trim()) return null;

  try {
    const parsed = JSON.parse(json.trim());
    const result = BrainDocSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    console.warn('[parseBrainDoc] Validation failed:', result.error.issues);
  } catch {
    // Invalid JSON
  }

  return null;
}

// ============================================================
// Research Round Operations
// ============================================================

/**
 * Increment the research round (called when Brain spawns new questions after evaluation)
 */
export function incrementResearchRound(doc: BrainDoc): BrainDoc {
  return {
    ...doc,
    researchRound: (doc.researchRound || 1) + 1,
  };
}

// ============================================================
// ResearchQuestion Operations
// ============================================================

/**
 * Add a new question to the document
 */
export function addResearchQuestion(
  doc: BrainDoc,
  name: string,
  question: string,
  goal: string,
  maxCycles: number = 10
): BrainDoc {
  const currentRound = doc.researchRound || 1;
  const newQuestion = createResearchQuestion(name, question, goal, maxCycles, currentRound);
  return {
    ...doc,
    questions: [...doc.questions, newQuestion],
  };
}

/**
 * Get an question by ID
 */
export function getResearchQuestion(doc: BrainDoc, questionId: string): ResearchQuestion | undefined {
  return doc.questions.find(i => i.id === questionId);
}

/**
 * Get all pending questions
 */
export function getPendingResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'pending');
}

/**
 * Get all running questions
 */
export function getRunningResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'running');
}

/**
 * Get all completed questions
 */
export function getCompletedResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(i => i.status === 'done');
}

/**
 * Update an question's status
 */
export function updateResearchQuestionStatus(
  doc: BrainDoc,
  questionId: string,
  status: ResearchQuestion['status']
): BrainDoc {
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
export function startResearchQuestion(doc: BrainDoc, questionId: string): BrainDoc {
  return updateResearchQuestionStatus(doc, questionId, 'running');
}

/**
 * Complete an question with results
 */
export function completeResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  summary: string,
  confidence: ResearchQuestion['confidence'],
  recommendation: ResearchQuestion['recommendation']
): BrainDoc {
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
export function incrementResearchQuestionCycle(doc: BrainDoc, questionId: string): BrainDoc {
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
  doc: BrainDoc,
  questionId: string,
  content: string,
  sources: Source[] = []
): BrainDoc {
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
  doc: BrainDoc,
  questionId: string,
  findingId: string,
  content: string
): BrainDoc {
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
  doc: BrainDoc,
  questionId: string,
  findingId: string,
  reason: string
): BrainDoc {
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
export function addSearchToResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  query: string,
  answer: string,
  sources: { url: string; title?: string }[] = [],
  reasoning?: string
): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(i =>
      i.id === questionId
        ? {
            ...i,
            searches: [...(i.searches || []), { query, answer, sources, reasoning }],
          }
        : i
    ),
  };
}

/**
 * Check if a query has been run in an question
 */
export function hasQueryBeenRunInResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  query: string
): boolean {
  const question = getResearchQuestion(doc, questionId);
  if (!question) return false;
  const normalized = query.toLowerCase().trim();
  return (question.searches || []).some(sr => sr.query.toLowerCase().trim() === normalized);
}

/**
 * Add a cycle reflection to an question
 */
export function addReflectionToResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  cycle: number,
  learned: string,
  nextStep: string,
  status: 'continue' | 'done'
): BrainDoc {
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
// Episode Memory (Structured deltas)
// ============================================================

export function normalizeQuery(q: string): string {
  return (q || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Add a new episode to a question.
 */
export function addEpisodeToResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  episode: Omit<Episode, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
): BrainDoc {
  const ep: Episode = {
    id: episode.id || generateEpisodeId(),
    timestamp: episode.timestamp || new Date().toISOString(),
    cycle: episode.cycle,
    query: episode.query,
    purpose: episode.purpose || '',
    sources: episode.sources || [],
    deltaType: episode.deltaType,
    nextStep: episode.nextStep || '',
    status: episode.status,
  };

  return {
    ...doc,
    questions: doc.questions.map(q =>
      q.id === questionId
        ? { ...q, episodes: [...(q.episodes || []), ep] }
        : q
    ),
  };
}

/**
 * Return the number of consecutive episodes at the end of the list that had no useful delta.
 * (deltaType === 'no_change' OR empty delta)
 */
export function getNoDeltaStreak(doc: BrainDoc, questionId: string): number {
  const q = getResearchQuestion(doc, questionId);
  if (!q) return 0;
  const eps = q.episodes || [];
  let streak = 0;
  for (let i = eps.length - 1; i >= 0; i--) {
    const e = eps[i];
    const noDelta = e.deltaType === 'no_change';
    if (!noDelta) break;
    streak++;
  }
  return streak;
}

/**
 * Merge a set of "don't repeat" queries into a question's episode stream (latest episode),
 * returning a unique, normalized list.
 */
export function mergeDontRepeat(base: string[], extra: string[]): string[] {
  const out = new Set<string>();
  for (const q of [...(base || []), ...(extra || [])]) {
    const n = normalizeQuery(q);
    if (n) out.add(n);
  }
  return Array.from(out);
}

// ============================================================
// Compaction & Guardrails (keep brain bounded)
// ============================================================

export interface CompactionOptions {
  maxEpisodesPerQuestion: number;
  maxSearchsPerQuestion: number;
  maxReflectionsPerQuestion: number;
}

const DEFAULT_COMPACTION: CompactionOptions = {
  maxEpisodesPerQuestion: 30,
  maxSearchsPerQuestion: 25,
  maxReflectionsPerQuestion: 30,
};

function compactArray<T>(items: T[], keepLast: number): { kept: T[]; removedCount: number } {
  if (!Array.isArray(items)) return { kept: [], removedCount: 0 };
  if (items.length <= keepLast) return { kept: items, removedCount: 0 };
  return { kept: items.slice(items.length - keepLast), removedCount: items.length - keepLast };
}

/**
 * Compact a single question to keep memory bounded.
 *
 * Strategy:
 * - Keep the latest N episodes/searches/reflections for "live debugging" + UI
 * - If we dropped any episodes, prepend a synthetic episode summarizing that compaction happened
 */
export function compactResearchQuestion(
  q: ResearchQuestion,
  options: Partial<CompactionOptions> = {}
): ResearchQuestion {
  const opts: CompactionOptions = { ...DEFAULT_COMPACTION, ...options };

  const { kept: keptEpisodes, removedCount: removedEpisodes } = compactArray(q.episodes || [], opts.maxEpisodesPerQuestion);
  const { kept: keptSearches, removedCount: removedSearches } = compactArray(q.searches || [], opts.maxSearchsPerQuestion);
  const { kept: keptReflections, removedCount: removedReflections } = compactArray(q.reflections || [], opts.maxReflectionsPerQuestion);

  let episodesOut = keptEpisodes;

  if (removedEpisodes > 0) {
    const firstCycleKept = episodesOut[0]?.cycle ?? q.cycles;
    const synthetic: Episode = {
      id: generateEpisodeId(),
      timestamp: new Date().toISOString(),
      cycle: Math.max(0, firstCycleKept - 1),
      query: '[compacted]',
      purpose: '',
      sources: [],
      deltaType: 'no_change',
      nextStep: `Compacted history: removed ${removedEpisodes} older episode(s), ${removedSearches} older search result(s), ${removedReflections} older reflection(s).`,
      status: 'continue',
    };
    episodesOut = [synthetic, ...episodesOut];
  }

  return {
    ...q,
    episodes: episodesOut,
    searches: keptSearches,
    reflections: keptReflections,
  };
}

/**
 * Compact the entire BrainDoc for storage/streaming.
 * Safe to call frequently (pure, deterministic).
 */
export function compactBrainDoc(
  doc: BrainDoc,
  options: Partial<CompactionOptions> = {}
): BrainDoc {
  const opts: Partial<CompactionOptions> = options;
  return {
    ...doc,
    questions: doc.questions.map(q => compactResearchQuestion(q, opts)),
  };
}

// ============================================================
// Brain Decision Log
// ============================================================

/**
 * Add a brain decision to the log
 */
export function addBrainDecision(
  doc: BrainDoc,
  action: BrainAction,
  reasoning: string,
  questionId?: string
): BrainDoc {
  const decision = createBrainDecision(action, reasoning, questionId);
  return {
    ...doc,
    brainLog: [...doc.brainLog, decision],
  };
}

/**
 * Get the last brain decision
 */
export function getLastBrainDecision(doc: BrainDoc): BrainDecision | null {
  return doc.brainLog.length > 0 ? doc.brainLog[doc.brainLog.length - 1] : null;
}

// ============================================================
// Document Status
// ============================================================

/**
 * Set document status
 */
export function setDocStatus(doc: BrainDoc, status: BrainDoc['status']): BrainDoc {
  return { ...doc, status };
}

/**
 * Set final answer
 */
export function setFinalAnswer(doc: BrainDoc, finalAnswer: string): BrainDoc {
  return { ...doc, finalAnswer, status: 'complete' };
}

// ============================================================
// Formatting for Agent Context
// ============================================================

/**
 * Format BrainDoc for agent context
 */
export function formatBrainDocForAgent(doc: BrainDoc): string {
  const parts: string[] = [];

  parts.push('# Brain Research Document\n');
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
      parts.push(`**Question:** ${init.question}`);
      parts.push(`**Goal:** ${init.goal}`);
      parts.push(`**Cycles:** ${init.cycles}/${init.maxCycles}`);
      if ((init.episodes || []).length > 0) {
        const eps = init.episodes || [];
        const last = eps[eps.length - 1];
        parts.push(`**Episodes:** ${eps.length} (last: ${last.deltaType}${last.nextStep ? ` → ${last.nextStep.substring(0, 80)}${last.nextStep.length > 80 ? '...' : ''}` : ''})`);
      }

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

      if ((init.searches || []).length > 0) {
        parts.push(`\n**Searches:** ${init.searches.length}`);
      }
    }
  } else {
    parts.push('\n## ResearchQuestions');
    parts.push('(none yet)');
  }

  if (doc.brainLog.length > 0) {
    parts.push('\n## Decision Log (Recent)');
    const recentDecisions = doc.brainLog.slice(-5);
    for (const decision of recentDecisions) {
      parts.push(`- [${decision.action}] ${decision.reasoning.substring(0, 100)}${decision.reasoning.length > 100 ? '...' : ''}`);
    }
  }

  return parts.join('\n');
}

/**
 * Format question for agent context (single question view)
 */
export function formatResearchQuestionForAgent(q: ResearchQuestion): string {
  const parts: string[] = [];

  parts.push(`# ResearchQuestion: ${q.name}\n`);
  parts.push(`**ID:** ${q.id}`);
  parts.push(`**Question:** ${q.question}`);
  parts.push(`**Goal:** ${q.goal}`);
  parts.push(`**Status:** ${q.status}`);
  parts.push(`**Cycles:** ${q.cycles}/${q.maxCycles}`);

  if (q.confidence) parts.push(`**Confidence:** ${q.confidence}`);
  if (q.recommendation) parts.push(`**Recommendation:** ${q.recommendation}`);

  const activeFindings = q.findings.filter(f => f.status !== 'disqualified');
  const disqualifiedFindings = q.findings.filter(f => f.status === 'disqualified');

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

  const searches = q.searches || [];
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

  const reflections = q.reflections || [];
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
export function getResearchQuestionsSummary(doc: BrainDoc): string {
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
export function getAllFindings(doc: BrainDoc): { questionId: string; finding: Finding }[] {
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
export function getAllActiveFindings(doc: BrainDoc): { questionId: string; finding: Finding }[] {
  return getAllFindings(doc).filter(item => item.finding.status === 'active');
}
