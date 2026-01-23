'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  CheckCircle2,
  Circle,
  Loader2,
  ExternalLink,
  Search,
  ChevronDown,
  ChevronRight,
  Lightbulb,
} from 'lucide-react';

// Types
interface Finding {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
  status?: 'active' | 'disqualified';
  disqualifyReason?: string;
}

interface SearchResult {
  query: string;
  answer: string;
  sources: { url: string; title?: string }[];
}

interface CycleReflection {
  cycle: number;
  learned: string;
  nextStep: string;
  status: 'continue' | 'done';
}

interface Initiative {
  id: string;
  angle: string;
  rationale: string;
  question: string;
  hypothesis?: string;
  goal?: string;
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;
  findings: Finding[];
  queriesRun: string[];
  searchResults?: SearchResult[];
  reflections?: CycleReflection[];
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;
}

interface CortexDecision {
  id: string;
  timestamp: string;
  action: 'spawn' | 'drill_down' | 'kill' | 'synthesize';
  initiativeId?: string;
  reasoning: string;
}

interface CortexDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  initiatives: Initiative[];
  cortexLog: CortexDecision[];
  status: 'running' | 'synthesizing' | 'complete';
  finalAnswer?: string;
}

// Type guard to check if doc is CortexDoc
function isCortexDoc(doc: any): doc is CortexDoc {
  return doc && 'initiatives' in doc && 'cortexLog' in doc;
}

interface ResearchProgressProps {
  doc: any; // Accept any doc type, we'll type-guard it
  className?: string;
}

/**
 * Inline Research Progress Component
 * Shows a chronological timeline of all research activity
 */
export default function ResearchProgress({ doc: rawDoc, className }: ResearchProgressProps) {
  // Only render for CortexDoc (v1) format
  if (!isCortexDoc(rawDoc)) {
    return null;
  }

  const doc = rawDoc;

  // State to track which initiatives are expanded (all expanded by default)
  const [expandedInitiatives, setExpandedInitiatives] = useState<Set<string>>(
    new Set(doc.initiatives.map(i => i.id))
  );

  // Auto-expand new initiatives
  const currentIds = new Set(doc.initiatives.map(i => i.id));
  const newIds = doc.initiatives
    .filter(i => !expandedInitiatives.has(i.id))
    .map(i => i.id);
  if (newIds.length > 0) {
    setExpandedInitiatives(new Set([...expandedInitiatives, ...newIds]));
  }

  const toggleInitiative = (id: string) => {
    const next = new Set(expandedInitiatives);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedInitiatives(next);
  };

  return (
    <div className={cn("w-full", className)}>
      {/* Research Header */}
      <div className="mb-4 pb-4 border-b border-slate-200 dark:border-white/10">
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {doc.objective}
        </p>
      </div>

      {/* Timeline of all events */}
      <div className="space-y-4">
        {doc.initiatives.map((initiative, initIndex) => {
          const isDone = initiative.status === 'done';
          const isRunning = initiative.status === 'running';
          const isExpanded = expandedInitiatives.has(initiative.id);
          const angle = initiative.angle || initiative.hypothesis || 'Research';

          // Find cortex decision that spawned this initiative
          const spawnDecision = doc.cortexLog.find(
            d => d.action === 'spawn' && d.initiativeId === initiative.id
          );

          return (
            <div key={initiative.id} className="space-y-3">
              {/* Cortex decision that spawned this initiative */}
              {spawnDecision && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-gradient-to-br from-purple-50/50 to-indigo-50/50 dark:from-purple-500/5 dark:to-indigo-500/5 border border-purple-100/50 dark:border-purple-500/10"
                >
                  <div className="flex items-center gap-3">
                    <Brain className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {spawnDecision.reasoning}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Initiative card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 overflow-hidden"
              >
                {/* Initiative Header - clickable to expand/collapse */}
                <button
                  onClick={() => toggleInitiative(initiative.id)}
                  className="w-full p-4 flex items-start gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="mt-0.5">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : isRunning ? (
                      <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                        {angle}
                      </h3>
                      {initiative.confidence && (
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
                          initiative.confidence === 'high'
                            ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400"
                            : initiative.confidence === 'medium'
                              ? "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                              : "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400"
                        )}>
                          {initiative.confidence}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                      {initiative.question || initiative.goal}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                      <span>{initiative.cycles}/{initiative.maxCycles} cycles</span>
                      <span>{initiative.searchResults?.length || 0} searches</span>
                      <span>{initiative.findings.filter(f => f.status !== 'disqualified').length} findings</span>
                    </div>
                  </div>
                  <div className="mt-1">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                </button>

                {/* Expanded content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-0 border-t border-slate-100 dark:border-white/5">
                        {/* Research Timeline */}
                        <div className="space-y-4 mt-4">
                          {(initiative.searchResults?.length || 0) === 0 && initiative.status === 'running' && (
                            <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-4">
                              Researching...
                            </p>
                          )}

                          {/* Interleave searches and reflections chronologically */}
                          {initiative.searchResults?.map((sr, i) => {
                            // Check if there's a reflection after this search
                            // Reflections happen at end of cycles, roughly every few searches
                            const reflectionForThisPoint = initiative.reflections?.find(
                              r => r.cycle === Math.ceil((i + 1) / 3) &&
                                   (i + 1) === r.cycle * 3 ||
                                   (i + 1 === initiative.searchResults?.length && r.cycle === initiative.cycles)
                            );

                            return (
                              <div key={i} className="space-y-3">
                                {/* Search result */}
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="space-y-2"
                                >
                                  <div className="flex items-start gap-2">
                                    <Search className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                      <span className="text-slate-400 dark:text-slate-500">Searching: </span>
                                      <span className="font-medium text-slate-700 dark:text-slate-300">{sr.query}</span>
                                    </p>
                                  </div>
                                  <div className="ml-6 p-3 rounded-lg bg-slate-50 dark:bg-white/3 border border-slate-100 dark:border-white/5">
                                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                      {sr.answer || 'No results'}
                                    </p>
                                    {sr.sources?.length > 0 && (
                                      <div className="flex flex-wrap gap-2 mt-2">
                                        {sr.sources.slice(0, 3).map((source, j) => {
                                          let domain = '';
                                          try {
                                            domain = new URL(source.url).hostname.replace('www.', '');
                                          } catch {
                                            domain = source.url;
                                          }
                                          return (
                                            <a
                                              key={j}
                                              href={source.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500 transition-colors"
                                            >
                                              <ExternalLink className="w-3 h-3" />
                                              {domain}
                                            </a>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              </div>
                            );
                          })}

                          {/* Show all reflections in order */}
                          {initiative.reflections?.map((reflection, i) => (
                            <motion.div
                              key={`reflection-${i}`}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/10"
                            >
                              <div className="flex items-start gap-2">
                                <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                <div className="space-y-1">
                                  <p className="text-sm text-slate-700 dark:text-slate-300">
                                    <span className="font-medium">Learned: </span>
                                    {reflection.learned}
                                  </p>
                                  <p className="text-sm text-slate-600 dark:text-slate-400">
                                    <span className="font-medium">Next: </span>
                                    {reflection.nextStep}
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          ))}

                          {/* Summary when done */}
                          {initiative.status === 'done' && initiative.summary && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20"
                            >
                              <p className="text-sm text-green-700 dark:text-green-400">
                                <span className="font-medium">Summary: </span>
                                {initiative.summary}
                              </p>
                            </motion.div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}

        {/* Show synthesize decision at the end */}
        {doc.cortexLog.filter(d => d.action === 'synthesize').map((decision) => (
          <motion.div
            key={decision.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-gradient-to-br from-purple-50/50 to-indigo-50/50 dark:from-purple-500/5 dark:to-indigo-500/5 border border-purple-100/50 dark:border-purple-500/10"
          >
            <div className="flex items-center gap-3">
              <Brain className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {decision.reasoning}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Status indicator */}
      {doc.status === 'running' && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Research in progress...</span>
        </div>
      )}
      {doc.status === 'synthesizing' && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-indigo-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Synthesizing final answer...</span>
        </div>
      )}
    </div>
  );
}
