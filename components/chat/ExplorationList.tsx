'use client';

import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ResearchAngle {
  name: string;
  goal: string;
  stopWhen: string;
  status: 'active' | 'worked' | 'rejected';
  result?: string;
}

interface ExplorationListProps {
  list: ResearchAngle[] | null;
  objective?: string;
  className?: string;
}

export default function ExplorationList({ list, objective, className }: ExplorationListProps) {
  if (!list || list.length === 0) {
    return null;
  }

  // Count progress
  const totalCount = list.length;
  const workedCount = list.filter(a => a.status === 'worked').length;
  const rejectedCount = list.filter(a => a.status === 'rejected').length;
  const resolvedCount = workedCount + rejectedCount;
  const progressPercent = Math.round((resolvedCount / totalCount) * 100);

  // Find active angle
  const activeIdx = list.findIndex(a => a.status === 'active');

  return (
    <div className={cn("flex flex-col max-h-[50vh]", className)}>
      {/* Header */}
      <div className="shrink-0 mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Research Angles
        </h2>
        {objective && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{objective}</p>
        )}
      </div>

      {/* Progress */}
      <div className="shrink-0 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Progress
          </span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {workedCount} worked • {rejectedCount} rejected • {progressPercent}%
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

      {/* Angles List */}
      <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-2">
        <AnimatePresence mode="popLayout">
          {list.map((angle, idx) => {
            const isActive = idx === activeIdx;
            const isWorked = angle.status === 'worked';
            const isRejected = angle.status === 'rejected';

            return (
              <motion.div
                key={`angle-${idx}`}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className={cn(
                    "p-4 rounded-xl transition-all border",
                    isActive
                      ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20"
                      : isWorked
                        ? "bg-green-50/50 dark:bg-green-500/5 border-green-200/50 dark:border-green-500/10"
                        : isRejected
                          ? "bg-slate-50 dark:bg-white/5 border-slate-200/50 dark:border-white/5"
                          : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10"
                  )}
                >
                  {/* Header Row */}
                  <div className="flex items-start gap-3">
                    {/* Status Icon */}
                    <div className="shrink-0 mt-0.5">
                      {isWorked ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : isRejected ? (
                        <XCircle className="w-5 h-5 text-slate-400" />
                      ) : isActive ? (
                        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Angle Name */}
                      <p
                        className={cn(
                          "font-medium text-sm",
                          isWorked
                            ? "text-green-700 dark:text-green-400"
                            : isRejected
                              ? "text-slate-400 dark:text-slate-500"
                              : isActive
                                ? "text-blue-700 dark:text-blue-300"
                                : "text-slate-700 dark:text-slate-300"
                        )}
                      >
                        {angle.name}
                      </p>

                      {/* Goal */}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {angle.goal}
                      </p>

                      {/* Result (if resolved) */}
                      {angle.result && (
                        <p
                          className={cn(
                            "text-xs mt-2 p-2 rounded-lg",
                            isWorked
                              ? "bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                              : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400"
                          )}
                        >
                          {angle.result}
                        </p>
                      )}
                    </div>
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
