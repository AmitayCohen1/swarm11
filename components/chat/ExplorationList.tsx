'use client';

import { cn } from '@/lib/utils';
import { Target, CheckCircle2 } from 'lucide-react';

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
    <div className={cn(
      "h-full flex flex-col",
      className
    )}>
      {/* Objective */}
      {objective && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-blue-500/80" />
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Research Objective
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white leading-relaxed">
            {objective}
          </p>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-slate-200/60 dark:bg-white/5 mb-8" />

      {/* Progress */}
      <div className="flex items-center justify-between mb-4 px-1">
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          Research Progress
        </span>
        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
          {doneCount}/{list.length}
        </span>
      </div>

      {/* List */}
      <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar">
        {list.map((item, idx) => {
          const isActive = activeTarget === `${idx}`;
          return (
            <div key={idx} className="space-y-1">
              {/* Parent item */}
              <div
                className={cn(
                  "flex items-start gap-3 p-3 rounded-xl transition-all border",
                  item.done
                    ? "bg-slate-50/50 dark:bg-white/[0.02] border-transparent opacity-50"
                    : isActive
                      ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 shadow-md"
                      : "bg-white dark:bg-white/[0.04] border-slate-200/60 dark:border-white/10 shadow-sm"
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0",
                  item.done
                    ? "bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600"
                    : isActive
                      ? "bg-blue-500 text-white"
                      : "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                )}>
                  {idx}
                </span>
                <span className={cn(
                  "text-sm leading-snug flex-1",
                  item.done
                    ? "text-slate-500 dark:text-slate-500 line-through"
                    : isActive
                      ? "text-blue-900 dark:text-blue-100 font-semibold"
                      : "text-slate-700 dark:text-slate-200 font-medium"
                )}>
                  {item.item}
                </span>
                {item.done && (
                  <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                )}
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1.5" />
                )}
              </div>

              {/* Subtasks */}
              {item.subtasks && item.subtasks.length > 0 && (
                <div className="ml-6 space-y-1">
                  {item.subtasks.map((sub, subIdx) => {
                    const isSubActive = activeTarget === `${idx}.${subIdx}`;
                    return (
                      <div
                        key={subIdx}
                        className={cn(
                          "flex items-start gap-2 p-2 rounded-lg transition-all border",
                          sub.done
                            ? "bg-slate-50/30 dark:bg-white/[0.01] border-transparent opacity-50"
                            : isSubActive
                              ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30"
                              : "bg-white/50 dark:bg-white/[0.02] border-slate-100 dark:border-white/5"
                        )}
                      >
                        <span className={cn(
                          "w-8 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0",
                          sub.done
                            ? "bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600"
                            : isSubActive
                              ? "bg-blue-500 text-white"
                              : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
                        )}>
                          {idx}.{subIdx}
                        </span>
                        <span className={cn(
                          "text-xs leading-snug flex-1",
                          sub.done
                            ? "text-slate-400 dark:text-slate-600 line-through"
                            : isSubActive
                              ? "text-blue-800 dark:text-blue-200 font-medium"
                              : "text-slate-600 dark:text-slate-300"
                        )}>
                          {sub.item}
                        </span>
                        {sub.done && (
                          <CheckCircle2 className="w-3 h-3 text-blue-400 shrink-0" />
                        )}
                        {isSubActive && (
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0 mt-1" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
