'use client';

import { cn } from '@/lib/utils';
import {
  FileText,
  Search,
  Brain,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Info,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { EventLogEntry } from '@/hooks/useChatAgent';

interface EventLogProps {
  events: EventLogEntry[];
  className?: string;
}

const iconMap = {
  plan: FileText,
  search: Search,
  reflect: Brain,
  phase: ArrowRight,
  complete: CheckCircle2,
  error: AlertCircle,
  info: Info,
  log: Clock
};

const colorMap = {
  plan: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  search: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  reflect: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  phase: 'text-slate-500 bg-slate-500/10 border-slate-500/20',
  complete: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  error: 'text-red-500 bg-red-500/10 border-red-500/20',
  info: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
  log: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20'
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export default function EventLog({ events, className }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (events.length === 0) {
    return (
      <div className={cn("h-full flex flex-col", className)}>
        <div className="shrink-0 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Event Log
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Events will appear here as the agent works...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col", className)}>
      {/* Header */}
      <div className="shrink-0 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Event Log
          </h3>
          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5">
            {events.length} events
          </span>
        </div>
      </div>

      {/* Events List */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2 space-y-1.5">
          <AnimatePresence mode="popLayout">
            {events.map((event, idx) => {
              const Icon = iconMap[event.icon] || Info;
              const colors = colorMap[event.icon] || colorMap.info;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className={cn(
                    "flex items-start gap-2.5 p-2.5 rounded-xl border transition-all",
                    colors,
                    idx === events.length - 1 && "ring-2 ring-offset-1 ring-offset-white dark:ring-offset-[#0a0a0a]"
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    "shrink-0 w-6 h-6 rounded-lg flex items-center justify-center",
                    colors.replace('text-', 'bg-').replace('/10', '/20')
                  )}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {event.label}
                      </p>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    {event.detail && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {event.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
      </div>

      {/* Tool sequence summary (if research complete) */}
      {events.some(e => e.type === 'research_complete') && (
        <div className="shrink-0 mt-4 pt-4 border-t border-slate-100 dark:border-white/5">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
            Research completed
          </p>
        </div>
      )}
    </div>
  );
}
