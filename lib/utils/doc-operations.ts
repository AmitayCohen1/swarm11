/**
 * Document Operations - Version 7
 * Research Questions with Findings
 */

import {
  ResearchDoc,
  ResearchDocSchema,
  ResearchQuestion,
  Finding,
  Strategy,
  StrategyLogEntry,
  createInitialStrategyEntry,
  createStrategyEntry,
  createResearchQuestion,
  generateQuestionId,
  generateFindingId,
} from '../types/research-doc';
import type { DocEdit, ReflectionOutput } from '../types/doc-edit';

/**
 * Create a new research document
 */
export function createResearchDoc(
  objective: string,
  initialStrategy?: Strategy,
  initialQuestions?: string[]
): ResearchDoc {
  const initialEntry = initialStrategy
    ? createStrategyEntry(initialStrategy)
    : createInitialStrategyEntry(objective);

  // Create research questions from initial questions
  const researchQuestions = (initialQuestions || []).map(q => createResearchQuestion(q));

  return {
    version: 7,
    objective,
    researchQuestions,
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
 * Find a question by ID
 */
export function findQuestion(doc: ResearchDoc, questionId: string): ResearchQuestion | undefined {
  return doc.researchQuestions.find(q => q.id === questionId);
}

/**
 * Find a question index by ID
 */
export function findQuestionIndex(doc: ResearchDoc, questionId: string): number {
  return doc.researchQuestions.findIndex(q => q.id === questionId);
}

/**
 * Apply a single edit operation
 * Returns a new document (immutable)
 */
export function applyEdit(doc: ResearchDoc, edit: DocEdit): ResearchDoc {
  const now = new Date().toISOString();

  switch (edit.action) {
    case 'add_question': {
      if (!edit.questionText) {
        console.warn('[applyEdit] add_question requires questionText');
        return doc;
      }
      const newQuestion = createResearchQuestion(edit.questionText);
      return {
        ...doc,
        researchQuestions: [...doc.researchQuestions, newQuestion],
        lastUpdated: now,
      };
    }

    case 'add_finding': {
      if (!edit.questionId) {
        console.warn('[applyEdit] add_finding requires questionId');
        return doc;
      }
      const qIdx = findQuestionIndex(doc, edit.questionId);
      if (qIdx === -1) {
        console.warn(`[applyEdit] Question "${edit.questionId}" not found`);
        return doc;
      }
      const question = doc.researchQuestions[qIdx];
      const newFinding: Finding = {
        id: generateFindingId(),
        content: edit.content || '',
        sources: edit.sources || [],
        status: 'active',
      };
      const newQuestions = [...doc.researchQuestions];
      newQuestions[qIdx] = {
        ...question,
        findings: [...question.findings, newFinding],
      };
      return {
        ...doc,
        researchQuestions: newQuestions,
        lastUpdated: now,
      };
    }

    case 'edit_finding': {
      if (!edit.questionId || !edit.findingId) {
        console.warn('[applyEdit] edit_finding requires questionId and findingId');
        return doc;
      }
      const qIdx = findQuestionIndex(doc, edit.questionId);
      if (qIdx === -1) return doc;

      const question = doc.researchQuestions[qIdx];
      const newFindings = question.findings.map(f => {
        if (f.id === edit.findingId) {
          return {
            ...f,
            content: edit.content ?? f.content,
            sources: edit.sources ?? f.sources,
          };
        }
        return f;
      });

      const newQuestions = [...doc.researchQuestions];
      newQuestions[qIdx] = { ...question, findings: newFindings };
      return {
        ...doc,
        researchQuestions: newQuestions,
        lastUpdated: now,
      };
    }

    case 'remove_finding': {
      if (!edit.questionId || !edit.findingId) {
        console.warn('[applyEdit] remove_finding requires questionId and findingId');
        return doc;
      }
      const qIdx = findQuestionIndex(doc, edit.questionId);
      if (qIdx === -1) return doc;

      const question = doc.researchQuestions[qIdx];
      const newFindings = question.findings.filter(f => f.id !== edit.findingId);

      const newQuestions = [...doc.researchQuestions];
      newQuestions[qIdx] = { ...question, findings: newFindings };
      return {
        ...doc,
        researchQuestions: newQuestions,
        lastUpdated: now,
      };
    }

    case 'disqualify_finding': {
      if (!edit.questionId || !edit.findingId) {
        console.warn('[applyEdit] disqualify_finding requires questionId and findingId');
        return doc;
      }
      if (!edit.disqualifyReason) {
        console.warn('[applyEdit] disqualify_finding requires disqualifyReason');
        return doc;
      }
      const qIdx = findQuestionIndex(doc, edit.questionId);
      if (qIdx === -1) return doc;

      const question = doc.researchQuestions[qIdx];
      const newFindings = question.findings.map(f => {
        if (f.id === edit.findingId) {
          return {
            ...f,
            status: 'disqualified' as const,
            disqualifyReason: edit.disqualifyReason,
          };
        }
        return f;
      });

      const newQuestions = [...doc.researchQuestions];
      newQuestions[qIdx] = { ...question, findings: newFindings };
      return {
        ...doc,
        researchQuestions: newQuestions,
        lastUpdated: now,
      };
    }

    case 'mark_question_done': {
      if (!edit.questionId) {
        console.warn('[applyEdit] mark_question_done requires questionId');
        return doc;
      }
      const qIdx = findQuestionIndex(doc, edit.questionId);
      if (qIdx === -1) return doc;

      const newQuestions = [...doc.researchQuestions];
      newQuestions[qIdx] = {
        ...doc.researchQuestions[qIdx],
        status: 'done',
      };
      return {
        ...doc,
        researchQuestions: newQuestions,
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
 * Add a new research question
 */
export function addResearchQuestion(doc: ResearchDoc, questionText: string): ResearchDoc {
  const question = createResearchQuestion(questionText);
  return {
    ...doc,
    researchQuestions: [...doc.researchQuestions, question],
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
 * Shows questions with their findings so agent can reference them
 */
export function formatDocForAgent(doc: ResearchDoc): string {
  const parts: string[] = [];
  const currentStrategy = getCurrentStrategy(doc);

  parts.push('# Research Document\n');
  parts.push(`**Objective:** ${doc.objective}`);

  if (currentStrategy) {
    parts.push('\n## Current Strategy');
    parts.push(`**Approach:** ${currentStrategy.approach}`);
    parts.push(`**Rationale:** ${currentStrategy.rationale}`);
    if (currentStrategy.nextActions.length > 0) {
      parts.push('**Next Actions:**');
      for (const action of currentStrategy.nextActions) {
        parts.push(`- ${action}`);
      }
    }
  }

  // Research Questions with findings
  if (doc.researchQuestions.length > 0) {
    parts.push('\n## Research Questions');
    for (const question of doc.researchQuestions) {
      const statusIcon = question.status === 'done' ? '✓' : '○';
      parts.push(`\n### [${question.id}] ${statusIcon} ${question.question}`);

      const activeFindings = question.findings.filter(f => f.status !== 'disqualified');
      const disqualifiedFindings = question.findings.filter(f => f.status === 'disqualified');

      if (activeFindings.length === 0 && disqualifiedFindings.length === 0) {
        parts.push('(no findings yet)');
      } else {
        // Active findings
        for (const finding of activeFindings) {
          parts.push(`- [${finding.id}] ${finding.content}`);
          if (finding.sources.length > 0) {
            const sourceList = finding.sources.map(s => s.title).join(', ');
            parts.push(`  Sources: ${sourceList}`);
          }
        }
        // Disqualified findings
        for (const finding of disqualifiedFindings) {
          parts.push(`- [${finding.id}] ~~${finding.content}~~ (${finding.disqualifyReason})`);
        }
      }
    }
  } else {
    parts.push('\n## Research Questions');
    parts.push('(none yet - add questions to investigate)');
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

  const openQuestions = doc.researchQuestions.filter(q => q.status === 'open');
  const doneQuestions = doc.researchQuestions.filter(q => q.status === 'done');

  parts.push(`\n**Questions:** ${openQuestions.length} open, ${doneQuestions.length} done`);

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
