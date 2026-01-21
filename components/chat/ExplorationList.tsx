'use client';

import { cn } from '@/lib/utils';
import { Target, Circle, CheckCircle2 } from 'lucide-react';

interface ExplorationItem {
  item: string;
  done: boolean;
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

  const pendingCount = list.filter(i => !i.done).length;
  const doneCount = list.filter(i => i.done).length;

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
      <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar">
        {list.map((item, idx) => (
          <div
            key={idx}
            className={cn(
              "flex items-start gap-3 p-3 rounded-xl transition-all border",
              item.done
                ? "bg-slate-50/50 dark:bg-white/[0.02] border-transparent opacity-50"
                : "bg-white dark:bg-white/[0.04] border-slate-200/60 dark:border-white/10 shadow-sm"
            )}
          >
            {item.done ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
            ) : (
              <div className="w-4 h-4 mt-0.5 rounded-full border-2 border-slate-200 dark:border-white/10 shrink-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              </div>
            )}
            <span className={cn(
              "text-sm leading-snug",
              item.done
                ? "text-slate-500 dark:text-slate-500 line-through"
                : "text-slate-700 dark:text-slate-200 font-medium"
            )}>
              {item.item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
