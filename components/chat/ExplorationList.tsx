'use client';

import { cn } from '@/lib/utils';
import { Target, Check } from 'lucide-react';
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
  className?: string;
}

export default function ExplorationList({ list, objective, className }: ExplorationListProps) {
  if (!list || list.length === 0) {
    return null;
  }

  // Count all items including subtasks
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

  // Find first pending (could be item or subtask)
  let activeTarget: string | null = null;
  outer: for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.subtasks && item.subtasks.length > 0) {
      for (let j = 0; j < item.subtasks.length; j++) {
        if (!item.subtasks[j].done) {
          activeTarget = `${i}.${j}`;
          break outer;
        }
      }
    }
    if (!item.done) {
      activeTarget = `${i}`;
      break;
    }
  }

  return (
    <div className={cn("h-full flex flex-col", className)}>
      {/* Objective */}
      {objective && (
        <div className="mb-5 shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Target className="w-3 h-3 text-blue-500" />
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Objective
            </span>
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white leading-relaxed">
            {objective}
          </p>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-5 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Progress
          </span>
          <span className="text-[10px] font-bold text-blue-500">
            {doneCount}/{totalCount}
          </span>
        </div>
        <div className="h-1 w-full bg-slate-200/50 dark:bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${(doneCount / totalCount) * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="space-y-1">
          <AnimatePresence mode="popLayout">
            {list.map((item, idx) => {
              const hasSubtasks = item.subtasks && item.subtasks.length > 0;
              const isParentActive = activeTarget === `${idx}` || activeTarget?.startsWith(`${idx}.`);
              const allSubtasksDone = !hasSubtasks || item.subtasks!.every(s => s.done);
              const isFullyDone = item.done && allSubtasksDone;
              const isLastItem = idx === list.length - 1;

              return (
                <motion.div
                  key={`${idx}-${item.item}`}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="relative"
                >
                  {/* Parent Item Row */}
                  <div className="flex items-start gap-2">
                    {/* Tree connector */}
                    <div className="relative flex flex-col items-center w-5 shrink-0">
                      {/* Vertical line above */}
                      {idx > 0 && (
                        <div className="absolute bottom-1/2 w-px h-3 bg-slate-300 dark:bg-white/10" />
                      )}
                      {/* Node circle */}
                      <div className={cn(
                        "relative z-10 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all",
                        isFullyDone
                          ? "border-blue-400 bg-blue-400"
                          : isParentActive
                            ? "border-blue-500 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            : "border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900"
                      )}>
                        {isFullyDone && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        {isParentActive && !isFullyDone && (
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-white"
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                          />
                        )}
                      </div>
                      {/* Vertical line below (if has subtasks or not last) */}
                      {(hasSubtasks || !isLastItem) && (
                        <div className={cn(
                          "w-px flex-1 min-h-3",
                          hasSubtasks ? "bg-slate-300 dark:bg-white/10" : (!isLastItem ? "bg-slate-300 dark:bg-white/10" : "")
                        )} />
                      )}
                    </div>

                    {/* Content */}
                    <div className={cn(
                      "flex-1 pb-2 pt-0.5",
                      isFullyDone && "opacity-40"
                    )}>
                      <span className={cn(
                        "text-[13px] leading-snug",
                        isFullyDone
                          ? "text-slate-400 dark:text-slate-500 line-through"
                          : isParentActive
                            ? "text-slate-900 dark:text-white font-semibold"
                            : "text-slate-600 dark:text-slate-300"
                      )}>
                        {item.item}
                      </span>
                    </div>
                  </div>

                  {/* Subtasks */}
                  {hasSubtasks && (
                    <div className="ml-5">
                      {item.subtasks!.map((sub, subIdx) => {
                        const isSubActive = activeTarget === `${idx}.${subIdx}`;
                        const isLastSub = subIdx === item.subtasks!.length - 1;

                        return (
                          <motion.div
                            key={`${idx}.${subIdx}-${sub.item}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: subIdx * 0.03 }}
                            className="flex items-start gap-2"
                          >
                            {/* Tree connector for subtask */}
                            <div className="relative flex flex-col items-center w-5 shrink-0">
                              {/* Vertical line above */}
                              <div className={cn(
                                "w-px h-3",
                                "bg-slate-300 dark:bg-white/10"
                              )} />
                              {/* Horizontal branch */}
                              <div className="absolute top-3 left-1/2 w-2 h-px bg-slate-300 dark:bg-white/10" />
                              {/* Node dot */}
                              <div className={cn(
                                "relative z-10 w-2.5 h-2.5 rounded-full border-2 transition-all",
                                sub.done
                                  ? "border-blue-400 bg-blue-400"
                                  : isSubActive
                                    ? "border-blue-500 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                                    : "border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900"
                              )}>
                                {sub.done && <Check className="w-1.5 h-1.5 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" strokeWidth={4} />}
                              </div>
                              {/* Vertical line below */}
                              {(!isLastSub || !isLastItem) && (
                                <div className={cn(
                                  "w-px flex-1 min-h-2",
                                  !isLastSub ? "bg-slate-300 dark:bg-white/10" : ""
                                )} />
                              )}
                            </div>

                            {/* Subtask content */}
                            <div className={cn(
                              "flex-1 pb-1.5 pt-0.5",
                              sub.done && "opacity-40"
                            )}>
                              <span className={cn(
                                "text-[12px] leading-snug",
                                sub.done
                                  ? "text-slate-400 dark:text-slate-500 line-through"
                                  : isSubActive
                                    ? "text-blue-600 dark:text-blue-400 font-medium"
                                    : "text-slate-500 dark:text-slate-400"
                              )}>
                                {sub.item}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
