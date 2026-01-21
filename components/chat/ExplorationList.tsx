'use client';

import { cn } from '@/lib/utils';
import { Target, CheckCircle2, Circle, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Subtask {
  item: string;
  done: boolean;
}

interface ExplorationItem {
  item: string;
  done: boolean;
  subtasks?: Subtask[];
}

interface ExplorationListProps {
  list: ExplorationItem[] | null;
  objective?: string;
  successCriteria?: string;
  outputFormat?: string;
  className?: string;
}

export default function ExplorationList({ list, objective, successCriteria, outputFormat, className }: ExplorationListProps) {
  if (!list || list.length === 0) {
    return null;
  }

  // Count progress
  let totalCount = 0;
  let doneCount = 0;
  for (const item of list) {
    totalCount++;
    if (item.done) doneCount++;
    if (item.subtasks) {
      for (const sub of item.subtasks) {
        totalCount++;
        if (sub.done) doneCount++;
      }
    }
  }

  // Find active item (first pending)
  let activeIdx: string | null = null;
  outer: for (let i = 0; i < list.length; i++) {
    const item = list[i];
    // Check subtasks first
    if (item.subtasks && item.subtasks.length > 0) {
      for (let j = 0; j < item.subtasks.length; j++) {
        if (!item.subtasks[j].done) {
          activeIdx = `${i}.${j}`;
          break outer;
        }
      }
    }
    if (!item.done) {
      activeIdx = `${i}`;
      break;
    }
  }

  const progressPercent = Math.round((doneCount / totalCount) * 100);

  return (
    <div className={cn("flex flex-col max-h-[50vh]", className)}>
      {/* Header */}
      <div className="shrink-0 mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Research Initiatives
        </h2>
        {objective && (
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">Objective: </span>
              <span className="text-slate-500 dark:text-slate-400">{objective}</span>
            </div>
            {successCriteria && (
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">Success: </span>
                <span className="text-slate-500 dark:text-slate-400">{successCriteria}</span>
              </div>
            )}
            {outputFormat && (
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">Format: </span>
                <span className="text-slate-500 dark:text-slate-400">{outputFormat}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="shrink-0 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Progress
          </span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {doneCount} of {totalCount} • {progressPercent}%
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Task Tree - items stay in place, no sorting */}
      <div className="flex-1 overflow-y-auto -mx-2 px-2">
        <AnimatePresence mode="popLayout">
          {list.map((item, idx) => {
            const hasSubtasks = item.subtasks && item.subtasks.length > 0;
            const isActive = activeIdx === `${idx}` || activeIdx?.startsWith(`${idx}.`);
            const allSubtasksDone = !hasSubtasks || item.subtasks!.every(s => s.done);
            const isFullyDone = item.done && allSubtasksDone;

            return (
              <motion.div
                key={`item-${idx}`}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="mb-1"
              >
                {/* Parent Task */}
                <div
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl transition-all",
                    isActive && !isFullyDone
                      ? "bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20"
                      : "hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  {/* Status Icon */}
                  <div className="shrink-0 mt-0.5">
                    {isFullyDone ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : isActive ? (
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm leading-relaxed",
                        isFullyDone
                          ? "text-slate-400 dark:text-slate-500 line-through"
                          : isActive
                            ? "text-slate-900 dark:text-white font-medium"
                            : "text-slate-700 dark:text-slate-300"
                      )}
                    >
                      {item.item}
                    </p>

                    {/* Subtasks */}
                    {hasSubtasks && (
                      <div className="mt-3 space-y-1 pl-1 border-l-2 border-slate-200 dark:border-white/10">
                        {item.subtasks!.map((sub, subIdx) => {
                          const isSubActive = activeIdx === `${idx}.${subIdx}`;

                          return (
                            <motion.div
                              key={`sub-${idx}-${subIdx}`}
                              initial={{ opacity: 0, x: -5 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: subIdx * 0.05 }}
                              className={cn(
                                "flex items-start gap-2 py-1.5 px-3 rounded-lg ml-1",
                                isSubActive && "bg-blue-100/50 dark:bg-blue-500/10"
                              )}
                            >
                              {/* Subtask Icon */}
                              <div className="shrink-0 mt-0.5">
                                {sub.done ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : isSubActive ? (
                                  <ChevronRight className="w-4 h-4 text-blue-500 animate-pulse" />
                                ) : (
                                  <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                                )}
                              </div>

                              {/* Subtask Text */}
                              <p
                                className={cn(
                                  "text-[13px] leading-relaxed",
                                  sub.done
                                    ? "text-slate-400 dark:text-slate-500 line-through"
                                    : isSubActive
                                      ? "text-blue-700 dark:text-blue-300 font-medium"
                                      : "text-slate-600 dark:text-slate-400"
                                )}
                              >
                                {sub.item}
                              </p>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      </div>
  );
}
