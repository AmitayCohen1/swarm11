/**
 * Document Operations - Version 4
 * Item-based sections with add/remove/edit operations
 */

import {
  ResearchDoc,
  ResearchDocSchema,
  Section,
  SectionItem,
  Strategy,
  createInitialStrategy,
  generateSectionId,
  generateItemId,
} from '../types/research-doc';
import type { DocEdit, ReflectionOutput } from '../types/doc-edit';

/**
 * Create a new research document
 */
export function createResearchDoc(
  objective: string,
  doneWhen: string,
  initialStrategy?: Strategy
): ResearchDoc {
  return {
    version: 4,
    objective,
    doneWhen,
    sections: [],
    strategy: initialStrategy || createInitialStrategy(objective),
    queriesRun: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Find a section by title
 */
export function findSection(doc: ResearchDoc, title: string): Section | undefined {
  return doc.sections.find(s => s.title.toLowerCase() === title.toLowerCase());
}

/**
 * Find a section index by title
 */
export function findSectionIndex(doc: ResearchDoc, title: string): number {
  return doc.sections.findIndex(s => s.title.toLowerCase() === title.toLowerCase());
}

/**
 * Apply a single edit operation
 * Returns a new document (immutable)
 */
export function applyEdit(doc: ResearchDoc, edit: DocEdit): ResearchDoc {
  const now = new Date().toISOString();
  let sectionIdx = findSectionIndex(doc, edit.sectionTitle);

  // Create section if it doesn't exist (for add_item)
  if (sectionIdx === -1 && edit.action === 'add_item') {
    const newSection: Section = {
      id: generateSectionId(),
      title: edit.sectionTitle,
      items: [],
    };
    doc = {
      ...doc,
      sections: [...doc.sections, newSection],
    };
    sectionIdx = doc.sections.length - 1;
  }

  // If section still doesn't exist, return unchanged
  if (sectionIdx === -1) {
    console.warn(`[applyEdit] Section "${edit.sectionTitle}" not found for ${edit.action}`);
    return doc;
  }

  const section = doc.sections[sectionIdx];
  let newItems: SectionItem[];

  switch (edit.action) {
    case 'add_item':
      const newItem: SectionItem = {
        id: generateItemId(),
        content: edit.content || '',
        sources: edit.sources || [],
      };
      newItems = [...section.items, newItem];
      break;

    case 'remove_item':
      if (!edit.itemId) {
        console.warn('[applyEdit] remove_item requires itemId');
        return doc;
      }
      newItems = section.items.filter(item => item.id !== edit.itemId);
      break;

    case 'edit_item':
      if (!edit.itemId) {
        console.warn('[applyEdit] edit_item requires itemId');
        return doc;
      }
      newItems = section.items.map(item => {
        if (item.id === edit.itemId) {
          return {
            ...item,
            content: edit.content ?? item.content,
            sources: edit.sources ?? item.sources,
          };
        }
        return item;
      });
      break;

    default:
      return doc;
  }

  const newSections = [...doc.sections];
  newSections[sectionIdx] = {
    ...section,
    items: newItems,
  };

  return {
    ...doc,
    sections: newSections,
    lastUpdated: now,
  };
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
    newDoc = {
      ...newDoc,
      strategy: output.strategyUpdate,
      lastUpdated: new Date().toISOString(),
    };
  }

  return newDoc;
}

/**
 * Update the strategy
 */
export function updateStrategy(doc: ResearchDoc, strategy: Strategy): ResearchDoc {
  return {
    ...doc,
    strategy,
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
 * Shows items with their IDs so agent can reference them for edit/remove
 */
export function formatDocForAgent(doc: ResearchDoc): string {
  const parts: string[] = [];

  parts.push('# Research Document\n');
  parts.push(`**Objective:** ${doc.objective}`);
  parts.push(`**Done When:** ${doc.doneWhen}`);

  parts.push('\n## Strategy');
  parts.push(`**Approach:** ${doc.strategy.approach}`);
  parts.push(`**Rationale:** ${doc.strategy.rationale}`);
  if (doc.strategy.nextActions.length > 0) {
    parts.push('**Next Actions:**');
    for (const action of doc.strategy.nextActions) {
      parts.push(`- ${action}`);
    }
  }

  if (doc.sections.length > 0) {
    parts.push('\n## Sections');
    for (const section of doc.sections) {
      parts.push(`\n### ${section.title}`);
      if (section.items.length === 0) {
        parts.push('(empty)');
      } else {
        for (const item of section.items) {
          parts.push(`- [${item.id}] ${item.content}`);
          if (item.sources.length > 0) {
            const sourceList = item.sources.map(s => s.title).join(', ');
            parts.push(`  Sources: ${sourceList}`);
          }
        }
      }
    }
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
  parts.push(`**Objective:** ${doc.objective}`);

  if (doc.sections.length > 0) {
    for (const section of doc.sections) {
      parts.push(`\n**${section.title}:** ${section.items.length} items`);
    }
  }

  parts.push(`\n**Strategy:** ${doc.strategy.approach}`);

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
