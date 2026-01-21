'use client';

import { cn } from '@/lib/utils';
import { ListTodo, Circle } from 'lucide-react';

interface ExplorationListProps {
  list: string[] | null;
  objective?: string;
  className?: string;
}

export default function ExplorationList({ list, objective, className }: ExplorationListProps) {
  if (!list || list.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden",
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Exploring
          </h3>
        </div>
        {objective && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
            {objective}
          </p>
        )}
      </div>

      {/* List items */}
      <div className="p-3 space-y-2">
        {list.map((item, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 group"
          >
            <Circle className="w-3 h-3 mt-1 text-slate-300 dark:text-slate-600 shrink-0" />
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
              {item}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
