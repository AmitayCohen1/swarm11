'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Brain, X } from 'lucide-react';

export interface DecisionEvent {
  id: string;
  type: 'spawn' | 'complete' | 'done' | 'start';
  reasoning: string;
  timestamp: number;
}

interface DecisionToastProps {
  events: DecisionEvent[];
}

function ToastItem({ event, onDismiss }: { event: DecisionEvent; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(enterTimer);
  }, []);

  const getTypeLabel = () => {
    switch (event.type) {
      case 'start':
        return 'Starting Research';
      case 'spawn':
        return 'Spawning Questions';
      case 'done':
        return 'Research Complete';
      default:
        return 'Decision';
    }
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 p-4 rounded-xl border backdrop-blur-md",
        "bg-slate-900/90 border-slate-700/50",
        "transition-all duration-300 ease-out shadow-xl",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/20">
            <Brain className="w-4 h-4 text-blue-400" />
          </div>
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
            {getTypeLabel()}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {/* Reasoning */}
      <p className="text-sm text-slate-300 leading-relaxed">
        {event.reasoning}
      </p>

      {/* Timestamp */}
      <p className="text-[10px] text-slate-600">
        {new Date(event.timestamp).toLocaleTimeString()}
      </p>
    </div>
  );
}

export default function DecisionToast({ events }: DecisionToastProps) {
  const [visibleEvents, setVisibleEvents] = useState<DecisionEvent[]>([]);

  useEffect(() => {
    if (events.length > 0) {
      const latestEvent = events[events.length - 1];
      setVisibleEvents(prev => {
        // Don't add duplicates
        if (prev.some(e => e.id === latestEvent.id)) return prev;
        // Keep only 1 visible at a time (stack would be too much)
        return [latestEvent];
      });
    }
  }, [events]);

  const dismissEvent = useCallback((id: string) => {
    setVisibleEvents(prev => prev.filter(e => e.id !== id));
  }, []);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (visibleEvents.length === 0) return;

    const timer = setTimeout(() => {
      setVisibleEvents([]);
    }, 8000);

    return () => clearTimeout(timer);
  }, [visibleEvents]);

  if (visibleEvents.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      {visibleEvents.map(event => (
        <ToastItem
          key={event.id}
          event={event}
          onDismiss={() => dismissEvent(event.id)}
        />
      ))}
    </div>
  );
}
