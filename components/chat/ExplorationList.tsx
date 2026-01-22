'use client';

import { cn } from '@/lib/utils';
import { Lightbulb, Target, ArrowRight, TrendingUp, TrendingDown, Minus, Sparkles, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  log: LogEntry[];
  objective?: string;
  doneWhen?: string;
  workingMemory?: WorkingMemory;
  className?: string;
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

/**
 * Mood display config - agent tells us the mood directly
 */
const moodConfig = {
  exploring: { label: 'Exploring', color: 'text-amber-500 bg-amber-500/10', icon: Minus },
  promising: { label: 'Promising', color: 'text-blue-500 bg-blue-500/10', icon: TrendingUp },
  dead_end: { label: 'Dead end', color: 'text-slate-400 bg-slate-400/10', icon: TrendingDown },
  breakthrough: { label: 'Breakthrough', color: 'text-emerald-500 bg-emerald-500/10', icon: Sparkles }
};

export default function ResearchLog({ log, objective, doneWhen, workingMemory, className }: ResearchLogProps) {
  if (!log || log.length === 0) {
    if (!objective && !doneWhen) {
      return null;
    }
  }

  return (
    <div className={cn("flex flex-col max-h-[50vh]", className)}>
      {/* Header */}
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

      {/* Working Memory - Narrative summary of the research journey */}
      {workingMemory && workingMemory.bullets && workingMemory.bullets.length > 0 && (
        <div className="shrink-0 mb-4 p-3 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-100 dark:border-violet-500/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-500" />
              <h3 className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                The story so far
              </h3>
            </div>
            <span className="text-[10px] text-violet-400 dark:text-violet-500">
              {workingMemory.lastUpdated ? formatTimeAgo(new Date(workingMemory.lastUpdated)) : ''}
            </span>
          </div>
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

      {/* Log count */}
      {log && log.length > 0 && (
        <div className="shrink-0 mb-3 text-xs font-medium text-slate-400 dark:text-slate-500">
          {log.length} iteration{log.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Log Entries - Narrative Style */}
      <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-3">
        <AnimatePresence mode="popLayout">
          {log && log.map((entry, idx) => {
            const mood = moodConfig[entry.mood] || moodConfig.exploring;
            const MoodIcon = mood.icon;
            const isLatest = idx === log.length - 1;

            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <div className={cn(
                  "p-4 rounded-xl border space-y-3 transition-all",
                  isLatest
                    ? "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 shadow-sm"
                    : "bg-slate-50/50 dark:bg-white/2 border-slate-100 dark:border-white/5"
                )}>
                  {/* Mood Label */}
                  <div className="flex items-center justify-between">
                    <div className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      mood.color
                    )}>
                      <MoodIcon className="w-3 h-3" />
                      {mood.label}
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      #{idx + 1}
                    </span>
                  </div>

                  {/* Narrative Content */}
                  <div className="space-y-2 text-sm">
                    {/* What I tried */}
                    <p className="text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-500 dark:text-slate-400">Tried:</span>{' '}
                      {entry.method}
                    </p>

                    {/* What I noticed */}
                    {entry.signal && (
                      <p className="text-slate-600 dark:text-slate-300">
                        <span className="font-medium text-slate-500 dark:text-slate-400">Noticed:</span>{' '}
                        {entry.signal.length > 150 ? entry.signal.substring(0, 150) + '...' : entry.signal}
                      </p>
                    )}

                    {/* What I learned */}
                    {entry.insight && (
                      <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                        <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                        <p className="text-slate-700 dark:text-slate-200 font-medium">
                          {entry.insight}
                        </p>
                      </div>
                    )}

                    {/* Why this matters (progress) */}
                    {entry.progressTowardObjective && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic pl-1 border-l-2 border-emerald-300 dark:border-emerald-500/50">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 not-italic">Why this matters:</span>{' '}
                        {entry.progressTowardObjective}
                      </p>
                    )}
                  </div>

                  {/* Sources (compact) */}
                  {entry.sources && entry.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {entry.sources.slice(0, 3).map((source, i) => {
                        const domain = source.url ? (() => {
                          try {
                            return new URL(source.url).hostname.replace('www.', '');
                          } catch {
                            return source.url;
                          }
                        })() : '';
                        return (
                          <a
                            key={i}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                          >
                            {domain}
                          </a>
                        );
                      })}
                      {entry.sources.length > 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 text-slate-400 dark:text-slate-500">
                          +{entry.sources.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Empty state */}
        {(!log || log.length === 0) && (
          <div className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <Target className="w-5 h-5 text-slate-300 dark:text-slate-600" />
            </div>
            Thinking will appear here...
          </div>
        )}
      </div>
    </div>
  );
}
