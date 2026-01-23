'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Brain,
  CheckCircle2,
  Circle,
  Loader2,
  ExternalLink,
  Search,
  Lightbulb,
  ChevronRight,
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
  learned?: string;
  nextAction?: string;
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
  name: string;
  description: string;
  goal: string;
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;
  findings: Finding[];
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
 * Shows tabbed initiatives with consolidated cortex reasoning
 */
export default function ResearchProgress({ doc: rawDoc, className }: ResearchProgressProps) {
  // Only render for CortexDoc (v1) format
  if (!isCortexDoc(rawDoc)) {
    console.log('[ResearchProgress] Not a CortexDoc:', rawDoc);
    return null;
  }

  const doc = rawDoc;

  // Debug: log when component renders with doc
  const totalSearches = doc.initiatives.reduce((sum, i) => sum + (i.searchResults?.length || 0), 0);
  console.log('[ResearchProgress] Rendering with:', {
    initiatives: doc.initiatives.length,
    totalSearches,
    status: doc.status
  });

  const [activeTab, setActiveTab] = useState<string | null>(
    doc.initiatives[0]?.id || null
  );

  // Update active tab when initiatives change
  if (activeTab && !doc.initiatives.find(i => i.id === activeTab)) {
    const firstInit = doc.initiatives[0];
    if (firstInit && activeTab !== firstInit.id) {
      setActiveTab(firstInit.id);
    }
  }

  // Set active tab to first initiative if not set
  if (!activeTab && doc.initiatives.length > 0) {
    setActiveTab(doc.initiatives[0].id);
  }

  const activeInitiative = doc.initiatives.find(i => i.id === activeTab);

  // Build consolidated intro message for all initiatives
  const buildIntroMessage = () => {
    if (doc.initiatives.length === 0) return null;

    const parts = [`I'll explore ${doc.initiatives.length} research angle${doc.initiatives.length > 1 ? 's' : ''}:`];

    doc.initiatives.forEach((init, i) => {
      parts.push(`\n${i + 1}. **${init.name}**`);
      parts.push(`   ${init.description}`);
      parts.push(`   → ${init.goal}`);
    });

    return parts.join('');
  };

  const introMessage = buildIntroMessage();

  return (
    <div className={cn("w-full", className)}>
      {/* Research Header */}
      <div className="mb-4 pb-4 border-b border-slate-200 dark:border-white/10">
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {doc.objective}
        </p>
      </div>

      {/* Consolidated Cortex Intro - One message introducing all initiatives */}
      {introMessage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 rounded-xl bg-gradient-to-br from-purple-50/50 to-indigo-50/50 dark:from-purple-500/5 dark:to-indigo-500/5 border border-purple-100/50 dark:border-purple-500/10"
        >
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
            <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
              {introMessage.split('\n').map((line, i) => {
                if (i === 0) {
                  return <p key={i}>{line}</p>;
                }
                // Parse markdown bold
                const parts = line.split(/\*\*(.*?)\*\*/);
                return (
                  <p key={i} className="ml-2">
                    {parts.map((part, j) =>
                      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                    )}
                  </p>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Initiative Tabs */}
      {doc.initiatives.length > 0 && (
        <div className="mb-4">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {doc.initiatives.map((initiative) => {
              const isActive = initiative.id === activeTab;
              const isDone = initiative.status === 'done';
              const isRunning = initiative.status === 'running';
              const name = initiative.name || 'Research';

              return (
                <button
                  key={initiative.id}
                  onClick={() => setActiveTab(initiative.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all",
                    isActive
                      ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-lg"
                      : isDone
                        ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-500/20 hover:bg-green-100 dark:hover:bg-green-500/20"
                        : isRunning
                          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
                          : "bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10"
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                  <span className="max-w-[150px] truncate">{name}</span>
                  {(initiative.searchResults?.length || 0) > 0 && (
                    <span className={cn(
                      "text-xs px-1.5 py-0.5 rounded-full",
                      isActive
                        ? "bg-white/20 text-white/80 dark:bg-black/20 dark:text-black/60"
                        : "bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                    )}>
                      {initiative.searchResults?.length || 0}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Initiative Content */}
      {activeInitiative && (
        <motion.div
          key={activeInitiative.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-4 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10"
        >
          {/* Initiative Header */}
          <div className="mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                {activeInitiative.name}
              </h3>
              {activeInitiative.confidence && (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  activeInitiative.confidence === 'high'
                    ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400"
                    : activeInitiative.confidence === 'medium'
                      ? "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                      : "bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400"
                )}>
                  {activeInitiative.confidence} confidence
                </span>
              )}
            </div>
            {/* Description - why this initiative matters */}
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
              {activeInitiative.description}
            </p>
            {/* Goal - what we're looking to achieve */}
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Goal: {activeInitiative.goal}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
              <span>{activeInitiative.cycles}/{activeInitiative.maxCycles} cycles</span>
              <span>{activeInitiative.searchResults?.length || 0} searches</span>
              <span>{activeInitiative.findings.filter(f => f.status !== 'disqualified').length} findings</span>
            </div>
          </div>

          {/* Research Timeline */}
          <div className="space-y-4">
            {(activeInitiative.searchResults?.length || 0) === 0 && activeInitiative.status === 'running' && (
              <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-4">
                Researching...
              </p>
            )}

            {activeInitiative.searchResults?.map((sr, i) => (
              <Collapsible key={i} defaultOpen={false}>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-2"
                >
                  {/* Always visible: Query */}
                  <CollapsibleTrigger className="w-full text-left group">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                      <Search className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-slate-700 dark:text-slate-300 font-medium flex-1">
                        {sr.query}
                      </p>
                    </div>
                  </CollapsibleTrigger>

                  {/* Collapsible: Answer + Sources */}
                  <CollapsibleContent>
                    <div className="ml-10 p-3 rounded-lg bg-slate-50 dark:bg-white/3 border border-slate-100 dark:border-white/5">
                      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {sr.answer || 'No results'}
                      </p>
                      {sr.sources?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {sr.sources.slice(0, 5).map((source, j) => {
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
                  </CollapsibleContent>

                  {/* Always visible: Learned + Next Action (under search results) */}
                  {(sr.learned || sr.nextAction) && (
                    <div className="ml-10 p-2 rounded-lg bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10 space-y-1">
                      {sr.learned && (
                        <p className="text-sm text-indigo-700 dark:text-indigo-300">
                          <span className="font-medium">Learned: </span>
                          {sr.learned}
                        </p>
                      )}
                      {sr.nextAction && (
                        <p className="text-sm text-indigo-600 dark:text-indigo-400">
                          <span className="font-medium">Next: </span>
                          {sr.nextAction}
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              </Collapsible>
            ))}

            {/* Show latest reflection */}
            {activeInitiative.reflections && activeInitiative.reflections.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/10"
              >
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      <span className="font-medium">Learned: </span>
                      {activeInitiative.reflections[activeInitiative.reflections.length - 1].learned}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-medium">Next: </span>
                      {activeInitiative.reflections[activeInitiative.reflections.length - 1].nextStep}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Summary when done */}
            {activeInitiative.status === 'done' && activeInitiative.summary && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20"
              >
                <p className="text-sm text-green-700 dark:text-green-400">
                  <span className="font-medium">Summary: </span>
                  {activeInitiative.summary}
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}

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
