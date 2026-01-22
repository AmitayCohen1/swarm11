'use client';

import { cn } from '@/lib/utils';
import { Clock, Target, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

// V3 Document-centric types
interface SectionItem {
  id: string;
  text: string;
  sources?: { url: string; title: string }[];
}

interface Section {
  id: string;
  title: string;
  items: SectionItem[];
  lastUpdated: string;
}

interface Strategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

interface ResearchDoc {
  northStar: string;
  currentObjective: string;
  doneWhen: string;
  sections: Section[];
  strategy: Strategy;
}

// Legacy V2 types for backwards compatibility
interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  signal: string;
  insight: string;
  progressTowardObjective: string;
  mood: 'exploring' | 'promising' | 'dead_end' | 'breakthrough';
  sources: { url: string; title: string }[];
}

interface WorkingMemory {
  bullets: string[];
  lastUpdated: string;
}

interface ResearchLogProps {
  doc?: ResearchDoc | null;
  log?: LogEntry[];
  objective?: string;
  doneWhen?: string;
  workingMemory?: WorkingMemory;
  className?: string;
}

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

/**
 * Research Document - Live updating markdown document
 */
export default function ResearchLog({
  doc,
  log,
  objective,
  doneWhen,
  workingMemory,
  className
}: ResearchLogProps) {

  // V3: Document-centric rendering - clean doc style
  if (doc) {
    return (
      <div className={cn("flex flex-col prose prose-slate dark:prose-invert max-w-none", className)}>
        {/* Document Header - Objective */}
        <div className="not-prose mb-10 pb-6 border-b border-slate-200 dark:border-white/10">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            {doc.currentObjective}
          </h1>
          {doc.doneWhen && (
            <p className="text-slate-500 dark:text-slate-400">
              <span className="font-medium">Done when:</span> {doc.doneWhen}
            </p>
          )}
        </div>

        {/* Strategy - subtle callout */}
        {doc.strategy && (
          <div className="not-prose mb-8 pl-4 border-l-2 border-indigo-300 dark:border-indigo-500/50">
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">Strategy</p>
            <p className="text-slate-700 dark:text-slate-300">{doc.strategy.approach}</p>
            {doc.strategy.nextActions.length > 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                → {doc.strategy.nextActions[0]}
              </p>
            )}
          </div>
        )}

        {/* Sections - clean document flow */}
        {doc.sections.map((section, idx) => {
          const hasItems = section.items && section.items.length > 0;

          // Skip empty sections except Key Findings
          if (!hasItems && !section.title.includes('Key Findings')) {
            return null;
          }

          return (
            <motion.div
              key={section.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.03 }}
              className="mb-10"
            >
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
                {section.title}
              </h2>

              {hasItems ? (
                <div className="space-y-0">
                  {section.items.map((item, itemIdx) => (
                    <div
                      key={item.id}
                      className="py-4 border-b border-slate-100 dark:border-white/5 last:border-0"
                    >
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        {item.text}
                      </p>
                      {item.sources && item.sources.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {item.sources.map((source, i) => {
                            const domain = (() => {
                              try {
                                return new URL(source.url).hostname.replace('www.', '');
                              } catch {
                                return source.url;
                              }
                            })();
                            return (
                              <a
                                key={i}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-slate-400 hover:text-blue-500"
                              >
                                {domain}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 dark:text-slate-500 italic">
                  Nothing yet...
                </p>
              )}
            </motion.div>
          );
        })}
      </div>
    );
  }

  // V2: Legacy log-based rendering (backwards compatibility)
  if (!log || log.length === 0) {
    if (!objective && !doneWhen) {
      return null;
    }
  }

  const moodConfig = {
    exploring: { label: 'Exploring', color: 'text-amber-500 bg-amber-500/10' },
    promising: { label: 'Promising', color: 'text-blue-500 bg-blue-500/10' },
    dead_end: { label: 'Dead end', color: 'text-slate-400 bg-slate-400/10' },
    breakthrough: { label: 'Breakthrough', color: 'text-emerald-500 bg-emerald-500/10' }
  };

  return (
    <div className={cn("flex flex-col max-h-[50vh]", className)}>
      <div className="shrink-0 mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
          Research Log
        </h2>
        {objective && (
          <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300 mb-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
            <Target className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
            <span>{objective}</span>
          </div>
        )}
        {doneWhen && (
          <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 p-2 rounded-lg bg-slate-50 dark:bg-white/3">
            <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
            <span><strong className="text-emerald-600 dark:text-emerald-400">Done when:</strong> {doneWhen}</span>
          </div>
        )}
      </div>

      {workingMemory && workingMemory.bullets && workingMemory.bullets.length > 0 && (
        <div className="shrink-0 mb-4 p-3 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-100 dark:border-violet-500/20">
          <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-300 mb-2">
            Key Findings
          </h3>
          <ul className="space-y-1.5">
            {workingMemory.bullets.map((bullet, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-violet-800 dark:text-violet-200">
                <span className="text-violet-400 dark:text-violet-500 mt-0.5">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3">
        {log && log.map((entry, idx) => {
          const mood = moodConfig[entry.mood] || moodConfig.exploring;
          return (
            <div key={entry.id} className="p-3 rounded-xl border border-slate-200/60 dark:border-white/5 bg-white/50 dark:bg-white/2">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase", mood.color)}>
                  {mood.label}
                </div>
                <span className="text-[10px] text-slate-400">#{idx + 1}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">
                <span className="font-medium text-slate-500">Tried:</span> {entry.method}
              </p>
              {entry.insight && (
                <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                  {entry.insight}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
