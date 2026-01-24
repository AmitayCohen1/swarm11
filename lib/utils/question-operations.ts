/**
 * ResearchQuestion Operations - Utility functions for BrainDoc manipulation
 *
 * SIMPLIFIED MEMORY MODEL:
 * - Each question has a `memory` array (list of messages)
 * - No more separate searches/episodes/reflections/findings
 */

import {
  BrainDoc,
  BrainDocSchema,
  ResearchQuestion,
  BrainDecision,
  BrainAction,
  MemoryEntry,
  QuestionDocument,
  createResearchQuestion,
  createBrainDecision,
  createBrainDoc,
} from '../types/research-question';

// ============================================================
// Document Creation & Parsing
// ============================================================

export function initializeBrainDoc(
  objective: string,
  successCriteria: string[]
): BrainDoc {
  return createBrainDoc(objective, successCriteria);
}

export function serializeBrainDoc(doc: BrainDoc): string {
  return JSON.stringify(doc, null, 2);
}

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

export function incrementResearchRound(doc: BrainDoc): BrainDoc {
  return {
    ...doc,
    researchRound: (doc.researchRound || 1) + 1,
  };
}

// ============================================================
// ResearchQuestion Operations
// ============================================================

export function addResearchQuestion(
  doc: BrainDoc,
  name: string,
  question: string,
  goal: string,
  maxCycles: number = 10,
  description?: string
): BrainDoc {
  const currentRound = doc.researchRound || 1;
  const newQuestion = createResearchQuestion(name, question, goal, maxCycles, currentRound, description);
  return {
    ...doc,
    questions: [...doc.questions, newQuestion],
  };
}

export function getResearchQuestion(doc: BrainDoc, questionId: string): ResearchQuestion | undefined {
  return doc.questions.find(q => q.id === questionId);
}

export function getPendingResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(q => q.status === 'pending');
}

export function getRunningResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(q => q.status === 'running');
}

export function getCompletedResearchQuestions(doc: BrainDoc): ResearchQuestion[] {
  return doc.questions.filter(q => q.status === 'done');
}

export function updateResearchQuestionStatus(
  doc: BrainDoc,
  questionId: string,
  status: ResearchQuestion['status']
): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(q =>
      q.id === questionId ? { ...q, status } : q
    ),
  };
}

export function startResearchQuestion(doc: BrainDoc, questionId: string): BrainDoc {
  return updateResearchQuestionStatus(doc, questionId, 'running');
}

export function completeResearchQuestion(
  doc: BrainDoc,
  questionId: string,
  summary: string,
  confidence: ResearchQuestion['confidence'],
  recommendation: ResearchQuestion['recommendation'],
  document?: QuestionDocument
): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(q =>
      q.id === questionId
        ? {
            ...q,
            status: 'done' as const,
            summary,  // Keep for backwards compatibility
            confidence,
            recommendation,
            document,  // New structured document
          }
        : q
    ),
  };
}

export function incrementResearchQuestionCycle(doc: BrainDoc, questionId: string): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(q =>
      q.id === questionId ? { ...q, cycles: q.cycles + 1 } : q
    ),
  };
}

// ============================================================
// Memory Operations (the new simple model)
// ============================================================

/**
 * Add a memory entry to a question
 */
export function addMemoryEntry(
  doc: BrainDoc,
  questionId: string,
  entry: MemoryEntry
): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(q =>
      q.id === questionId
        ? { ...q, memory: [...q.memory, entry] }
        : q
    ),
  };
}

/**
 * Add a search entry to memory
 */
export function addSearchToMemory(
  doc: BrainDoc,
  questionId: string,
  query: string
): BrainDoc {
  return addMemoryEntry(doc, questionId, { type: 'search', query });
}

/**
 * Add a result entry to memory
 */
export function addResultToMemory(
  doc: BrainDoc,
  questionId: string,
  answer: string,
  sources: { url: string; title?: string }[] = []
): BrainDoc {
  return addMemoryEntry(doc, questionId, { type: 'result', answer, sources });
}

/**
 * Add a reflect entry to memory
 */
export function addReflectToMemory(
  doc: BrainDoc,
  questionId: string,
  thought: string,
  delta?: 'progress' | 'no_change' | 'dead_end'
): BrainDoc {
  return addMemoryEntry(doc, questionId, { type: 'reflect', thought, delta });
}

/**
 * Get the last N memory entries for a question
 */
export function getRecentMemory(doc: BrainDoc, questionId: string, n: number = 10): MemoryEntry[] {
  const q = getResearchQuestion(doc, questionId);
  if (!q) return [];
  return q.memory.slice(-n);
}

/**
 * Get all search queries from a question's memory
 */
export function getSearchQueries(doc: BrainDoc, questionId: string): string[] {
  const q = getResearchQuestion(doc, questionId);
  if (!q) return [];
  return q.memory
    .filter((m): m is Extract<MemoryEntry, { type: 'search' }> => m.type === 'search')
    .map(m => m.query);
}

/**
 * Check if a query has been searched in a question
 */
export function hasQueryBeenSearched(
  doc: BrainDoc,
  questionId: string,
  query: string
): boolean {
  const queries = getSearchQueries(doc, questionId);
  const normalized = query.toLowerCase().trim();
  return queries.some(q => q.toLowerCase().trim() === normalized);
}

// ============================================================
// Compaction (keep memory bounded)
// ============================================================

export interface CompactionOptions {
  maxMemoryPerQuestion: number;
}

const DEFAULT_COMPACTION: CompactionOptions = {
  maxMemoryPerQuestion: 50,
};

export function compactResearchQuestion(
  q: ResearchQuestion,
  options: Partial<CompactionOptions> = {}
): ResearchQuestion {
  const opts = { ...DEFAULT_COMPACTION, ...options };

  if (q.memory.length <= opts.maxMemoryPerQuestion) {
    return q;
  }

  // Keep the most recent entries
  const kept = q.memory.slice(-opts.maxMemoryPerQuestion);

  // Add a note about compaction
  const compactionNote: MemoryEntry = {
    type: 'reflect',
    thought: `[Earlier memory compacted: ${q.memory.length - opts.maxMemoryPerQuestion} entries removed]`,
  };

  return {
    ...q,
    memory: [compactionNote, ...kept],
  };
}

export function compactBrainDoc(
  doc: BrainDoc,
  options: Partial<CompactionOptions> = {}
): BrainDoc {
  return {
    ...doc,
    questions: doc.questions.map(q => compactResearchQuestion(q, options)),
  };
}

// ============================================================
// Brain Decision Log
// ============================================================

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

export function getLastBrainDecision(doc: BrainDoc): BrainDecision | null {
  return doc.brainLog.length > 0 ? doc.brainLog[doc.brainLog.length - 1] : null;
}

// ============================================================
// Document Status
// ============================================================

export function setDocStatus(doc: BrainDoc, status: BrainDoc['status']): BrainDoc {
  return { ...doc, status };
}

export function setFinalAnswer(doc: BrainDoc, finalAnswer: string): BrainDoc {
  return { ...doc, finalAnswer, status: 'complete' };
}

// ============================================================
// Formatting for Agent Context
// ============================================================

export function formatBrainDocForAgent(doc: BrainDoc): string {
  const parts: string[] = [];

  parts.push('# Research Document\n');
  parts.push(`**Objective:** ${doc.objective}`);
  parts.push(`**Status:** ${doc.status}`);

  if (doc.successCriteria.length > 0) {
    parts.push('\n## Success Criteria');
    doc.successCriteria.forEach((c, i) => parts.push(`${i + 1}. ${c}`));
  }

  if (doc.questions.length > 0) {
    parts.push('\n## Research Questions');
    for (const q of doc.questions) {
      const statusIcon = q.status === 'done' ? '✓' : q.status === 'running' ? '→' : '○';
      parts.push(`\n### [${q.id}] ${statusIcon} ${q.name}`);
      parts.push(`**Question:** ${q.question}`);
      parts.push(`**Goal:** ${q.goal}`);
      parts.push(`**Cycles:** ${q.cycles}/${q.maxCycles}`);

      if (q.confidence) parts.push(`**Confidence:** ${q.confidence}`);
      if (q.recommendation) parts.push(`**Recommendation:** ${q.recommendation}`);

      // Show full document for completed questions
      if (q.document) {
        if (q.document.answer) {
          parts.push(`\n**Answer:**`);
          parts.push(q.document.answer);
        }
        if (q.document.keyFindings?.length > 0) {
          parts.push(`\n**Key Findings:**`);
          q.document.keyFindings.forEach(f => parts.push(`- ${f}`));
        }
        if (q.document.sources?.length > 0) {
          parts.push(`\n**Sources:**`);
          q.document.sources.slice(0, 5).forEach(s => {
            parts.push(`- ${s.title || s.url}${s.contribution ? `: ${s.contribution}` : ''}`);
          });
        }
        if (q.document.limitations) {
          parts.push(`\n**Limitations:** ${q.document.limitations}`);
        }
      } else if (q.summary) {
        parts.push(`**Summary:** ${q.summary}`);
      }

      // Show recent memory only for running questions
      if (q.status === 'running') {
        const recentMemory = q.memory.slice(-5);
        if (recentMemory.length > 0) {
          parts.push(`\n**Recent Memory (${q.memory.length} total):**`);
          for (const m of recentMemory) {
            if (m.type === 'search') {
              parts.push(`- 🔍 ${m.query}`);
            } else if (m.type === 'result') {
              const preview = m.answer.length > 100 ? m.answer.slice(0, 100) + '...' : m.answer;
              parts.push(`- 📄 ${preview}`);
            } else if (m.type === 'reflect') {
              parts.push(`- 💭 ${m.thought}`);
            }
          }
        }
      }
    }
  }

  if (doc.brainLog.length > 0) {
    parts.push('\n## Brain Decisions (Recent)');
    const recentDecisions = doc.brainLog.slice(-5);
    for (const d of recentDecisions) {
      const preview = d.reasoning.length > 100 ? d.reasoning.slice(0, 100) + '...' : d.reasoning;
      parts.push(`- [${d.action}] ${preview}`);
    }
  }

  return parts.join('\n');
}

export function formatResearchQuestionForAgent(q: ResearchQuestion): string {
  const parts: string[] = [];

  parts.push(`# Question: ${q.name}\n`);
  parts.push(`**ID:** ${q.id}`);
  parts.push(`**Question:** ${q.question}`);
  parts.push(`**Goal:** ${q.goal}`);
  parts.push(`**Status:** ${q.status}`);
  parts.push(`**Cycles:** ${q.cycles}/${q.maxCycles}`);

  if (q.confidence) parts.push(`**Confidence:** ${q.confidence}`);
  if (q.recommendation) parts.push(`**Recommendation:** ${q.recommendation}`);

  if (q.memory.length > 0) {
    parts.push('\n## Memory');
    for (const m of q.memory) {
      if (m.type === 'search') {
        parts.push(`\n🔍 **Search:** ${m.query}`);
      } else if (m.type === 'result') {
        parts.push(`📄 **Result:** ${m.answer}`);
        if (m.sources.length > 0) {
          parts.push(`   Sources: ${m.sources.map(s => s.url).join(', ')}`);
        }
      } else if (m.type === 'reflect') {
        parts.push(`💭 **Reflect:** ${m.thought}${m.delta ? ` (${m.delta})` : ''}`);
      }
    }
  }

  return parts.join('\n');
}

export function getResearchQuestionsSummary(doc: BrainDoc): string {
  const parts: string[] = [];

  const pending = getPendingResearchQuestions(doc);
  const running = getRunningResearchQuestions(doc);
  const done = getCompletedResearchQuestions(doc);

  parts.push(`**Questions:** ${done.length} done, ${running.length} running, ${pending.length} pending`);

  for (const q of doc.questions) {
    const statusIcon = q.status === 'done' ? '✓' : q.status === 'running' ? '→' : '○';
    const searchCount = q.memory.filter(m => m.type === 'search').length;
    parts.push(`- ${statusIcon} **${q.name}**: ${q.goal} (${searchCount} searches)`);
  }

  return parts.join('\n');
}

/**
 * Get all sources from all questions' memory
 */
export function getAllSources(doc: BrainDoc): { questionId: string; url: string; title?: string }[] {
  const results: { questionId: string; url: string; title?: string }[] = [];
  for (const q of doc.questions) {
    for (const m of q.memory) {
      if (m.type === 'result' && m.sources) {
        for (const s of m.sources) {
          results.push({ questionId: q.id, url: s.url, title: s.title });
        }
      }
    }
  }
  return results;
}

/**
 * Get all result answers from a question (for synthesis)
 */
export function getQuestionResults(doc: BrainDoc, questionId: string): string[] {
  const q = getResearchQuestion(doc, questionId);
  if (!q) return [];
  return q.memory
    .filter((m): m is Extract<MemoryEntry, { type: 'result' }> => m.type === 'result')
    .map(m => m.answer);
}
