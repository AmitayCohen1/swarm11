/**
 * Document Operations Utilities
 * Functions to create, modify, and format ResearchDoc
 */

import {
  ResearchDoc,
  ResearchDocSchema,
  Section,
  SectionItem,
  Strategy,
  createDefaultSections,
  createInitialStrategy,
  generateSectionId,
  generateItemId,
  DEFAULT_SECTION_TITLES,
} from '../types/research-doc';
import type { DocEdit, ReflectionOutput } from '../types/doc-edit';
import type { ResearchMemory } from '../types/research-memory';

/**
 * Create a new research document
 */
export function createResearchDoc(
  northStar: string,
  objective: string,
  doneWhen: string
): ResearchDoc {
  const now = new Date().toISOString();

  return {
    version: 3,
    northStar,
    currentObjective: objective,
    doneWhen,
    sections: createDefaultSections(),
    strategy: createInitialStrategy(objective),
    queriesRun: [],
    lastUpdated: now,
  };
}

/**
 * Find a section by title
 */
export function findSection(doc: ResearchDoc, title: string): Section | undefined {
  return doc.sections.find(s => s.title === title);
}

/**
 * Find a section index by title
 */
export function findSectionIndex(doc: ResearchDoc, title: string): number {
  return doc.sections.findIndex(s => s.title === title);
}

/**
 * Apply a single edit to the document
 * Returns a new document (immutable)
 */
export function applyEdit(doc: ResearchDoc, edit: DocEdit): ResearchDoc {
  const idx = findSectionIndex(doc, edit.sectionTitle);
  const now = new Date().toISOString();

  // Section doesn't exist - create it for add_items
  if (idx === -1) {
    if (edit.action !== 'add_items' || !edit.items?.length) {
      return doc;
    }

    const newItems: SectionItem[] = edit.items.map(item => ({
      id: generateItemId(),
      text: item.text,
      sources: item.sources,
    }));

    return {
      ...doc,
      sections: [
        ...doc.sections,
        {
          id: generateSectionId(),
          title: edit.sectionTitle,
          items: newItems,
          lastUpdated: now,
        },
      ],
      lastUpdated: now,
    };
  }

  const section = doc.sections[idx];
  let newItems: SectionItem[];

  switch (edit.action) {
    case 'add_items':
      const itemsToAdd: SectionItem[] = (edit.items || []).map(item => ({
        id: generateItemId(),
        text: item.text,
        sources: item.sources,
      }));
      newItems = [...section.items, ...itemsToAdd];
      break;

    case 'remove_items':
      const idsToRemove = new Set(edit.itemIds || []);
      newItems = section.items.filter(item => !idsToRemove.has(item.id));
      break;

    case 'replace_all':
      newItems = (edit.items || []).map(item => ({
        id: generateItemId(),
        text: item.text,
        sources: item.sources,
      }));
      break;

    default:
      return doc;
  }

  const newSections = [...doc.sections];
  newSections[idx] = {
    ...section,
    items: newItems,
    lastUpdated: now,
  };

  return {
    ...doc,
    sections: newSections,
    lastUpdated: now,
  };
}

/**
 * Apply multiple edits to the document
 * Returns a new document (immutable)
 */
export function applyEdits(doc: ResearchDoc, edits: DocEdit[]): ResearchDoc {
  return edits.reduce((currentDoc, edit) => applyEdit(currentDoc, edit), doc);
}

/**
 * Apply a reflection output to the document
 * Handles edits and optional strategy update
 */
export function applyReflectionOutput(
  doc: ResearchDoc,
  output: ReflectionOutput
): ResearchDoc {
  let newDoc = applyEdits(doc, output.documentEdits);

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
 * Add a query to the dedup list
 */
export function addQueryToDoc(doc: ResearchDoc, query: string): ResearchDoc {
  if (doc.queriesRun.includes(query)) {
    return doc;
  }

  return {
    ...doc,
    queriesRun: [...doc.queriesRun, query],
  };
}

/**
 * Add multiple queries to the dedup list
 */
export function addQueriesToDoc(doc: ResearchDoc, queries: string[]): ResearchDoc {
  const newQueries = queries.filter(q => !doc.queriesRun.includes(q));
  if (newQueries.length === 0) {
    return doc;
  }

  return {
    ...doc,
    queriesRun: [...doc.queriesRun, ...newQueries],
  };
}

/**
 * Check if a query has already been run
 */
export function hasQueryBeenRun(doc: ResearchDoc, query: string): boolean {
  const normalizedQuery = query.toLowerCase().trim();
  return doc.queriesRun.some(q => q.toLowerCase().trim() === normalizedQuery);
}

/**
 * Format document for agent context
 * Renders the document as a readable summary for LLM consumption
 */
export function formatDocForAgent(doc: ResearchDoc): string {
  const parts: string[] = [];

  parts.push('# Research Document\n');
  parts.push(`**North Star:** ${doc.northStar}`);
  parts.push(`**Current Objective:** ${doc.currentObjective}`);
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

  parts.push('\n## Sections');
  for (const section of doc.sections) {
    parts.push(`\n### ${section.title}`);
    if (section.items.length > 0) {
      for (const item of section.items) {
        parts.push(`\n- ${item.text}`);
        if (item.sources?.length) {
          const sourceList = item.sources.map(s => s.url).join(', ');
          parts.push(`  Sources: ${sourceList}`);
        }
      }
    } else {
      parts.push('_(empty)_');
    }
  }

  parts.push(`\n---`);
  parts.push(`**Queries Run:** ${doc.queriesRun.length}`);
  parts.push(`**Last Updated:** ${formatTimeAgo(new Date(doc.lastUpdated))}`);

  return parts.join('\n');
}

/**
 * Format document for display (shorter version)
 */
export function formatDocForDisplay(doc: ResearchDoc): string {
  const parts: string[] = [];

  parts.push(`**Objective:** ${doc.currentObjective}`);
  parts.push(`**Done When:** ${doc.doneWhen}`);

  for (const section of doc.sections) {
    if (section.items.length > 0) {
      parts.push(`\n**${section.title}:**`);
      for (const item of section.items) {
        parts.push(`- ${item.text}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Serialize document to JSON string for storage
 */
export function serializeDoc(doc: ResearchDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse document from JSON string
 * Returns null if invalid
 */
export function parseDoc(json: string): ResearchDoc | null {
  if (!json || !json.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(json.trim());

    // Validate with Zod
    const result = ResearchDocSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // If version 3 but validation failed, try to fix common issues
    if (parsed.version === 3) {
      console.warn('[parseDoc] Document version 3 but validation failed:', result.error.issues);
    }
  } catch (e) {
    // Invalid JSON
  }

  return null;
}

/**
 * Migrate v2 ResearchMemory to v3 ResearchDoc
 */
export function migrateV2toV3(memory: ResearchMemory): ResearchDoc {
  const now = new Date().toISOString();

  // Create default sections
  const sections = createDefaultSections();

  // Migrate working memory bullets to Key Findings
  const keyFindingsIdx = sections.findIndex(s => s.title === DEFAULT_SECTION_TITLES.KEY_FINDINGS);
  if (keyFindingsIdx !== -1 && memory.workingMemory?.bullets?.length > 0) {
    sections[keyFindingsIdx] = {
      ...sections[keyFindingsIdx],
      items: memory.workingMemory.bullets.map(b => ({
        id: generateItemId(),
        text: b,
      })),
      lastUpdated: memory.workingMemory.lastUpdated || now,
    };
  }

  // Migrate log insights to Raw Notes
  const rawNotesIdx = sections.findIndex(s => s.title === DEFAULT_SECTION_TITLES.RAW_NOTES);
  if (rawNotesIdx !== -1 && memory.log?.length > 0) {
    sections[rawNotesIdx] = {
      ...sections[rawNotesIdx],
      items: memory.log.map(entry => ({
        id: generateItemId(),
        text: `[${entry.method}] ${entry.insight}`,
        sources: entry.sources,
      })),
      lastUpdated: now,
    };
  }

  return {
    version: 3,
    northStar: memory.objective,
    currentObjective: memory.objective,
    doneWhen: memory.doneWhen,
    sections,
    strategy: {
      approach: 'Migrated from v2',
      rationale: 'Research migrated from log-centric architecture',
      nextActions: ['Continue research with document-centric approach'],
    },
    queriesRun: memory.queriesRun || [],
    lastUpdated: now,
  };
}

/**
 * Check if a brain string contains v3 document or v2 memory
 */
export function detectBrainVersion(brain: string): 2 | 3 | null {
  if (!brain || !brain.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(brain.trim());
    if (parsed.version === 3) return 3;
    if (parsed.version === 2) return 2;
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Parse brain content, handling v2 → v3 migration automatically
 */
export function parseBrainToDoc(brain: string): ResearchDoc | null {
  if (!brain || !brain.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(brain.trim());

    // Handle v3
    if (parsed.version === 3) {
      const result = ResearchDocSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    }

    // Handle v2 - migrate
    if (parsed.version === 2) {
      return migrateV2toV3(parsed as ResearchMemory);
    }
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Get section items by title
 */
export function getSectionItems(doc: ResearchDoc, title: string): SectionItem[] {
  const section = findSection(doc, title);
  return section?.items || [];
}

/**
 * Get a summary of the document for quick context
 */
export function getDocSummary(doc: ResearchDoc): string {
  const keyFindings = getSectionItems(doc, DEFAULT_SECTION_TITLES.KEY_FINDINGS);
  const openQuestions = getSectionItems(doc, DEFAULT_SECTION_TITLES.OPEN_QUESTIONS);

  const parts: string[] = [];
  parts.push(`**Objective:** ${doc.currentObjective}`);

  if (keyFindings.length > 0) {
    parts.push(`\n**Key Findings:**`);
    for (const item of keyFindings) {
      parts.push(`- ${item.text}`);
    }
  }

  if (openQuestions.length > 0) {
    parts.push(`\n**Open Questions:**`);
    for (const item of openQuestions) {
      parts.push(`- ${item.text}`);
    }
  }

  parts.push(`\n**Strategy:** ${doc.strategy.approach}`);

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
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}
