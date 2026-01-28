'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Brain, Zap, Search, CheckCircle } from 'lucide-react';

export interface DecisionEvent {
  id: string;
  type: 'spawn' | 'complete' | 'search' | 'decision' | 'strategy';
  message: string;
  detail?: string;
  timestamp: number;
}

interface DecisionToastProps {
  events: DecisionEvent[];
  maxVisible?: number;
}

function ToastItem({ event, onDone }: { event: DecisionEvent; onDone: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setIsVisible(true), 50);

    // Start exit after 3 seconds
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, 3000);

    // Remove after exit animation
    const removeTimer = setTimeout(() => {
      onDone();
    }, 3500);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [onDone]);

  const getIcon = () => {
    switch (event.type) {
      case 'spawn':
        return <Zap className="w-3 h-3" />;
      case 'complete':
        return <CheckCircle className="w-3 h-3" />;
      case 'search':
        return <Search className="w-3 h-3" />;
      case 'strategy':
      case 'decision':
      default:
        return <Brain className="w-3 h-3" />;
    }
  };

  const getColor = () => {
    switch (event.type) {
      case 'spawn':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'complete':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'search':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'strategy':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'decision':
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm",
        "transition-all duration-300 ease-out",
        getColor(),
        isVisible && !isExiting ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}
    >
      <div className="mt-0.5 shrink-0">
        {getIcon()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium leading-snug truncate">
          {event.message}
        </p>
        {event.detail && (
          <p className="text-[10px] opacity-60 truncate mt-0.5">
            {event.detail}
          </p>
        )}
      </div>
    </div>
  );
}

export default function DecisionToast({ events, maxVisible = 3 }: DecisionToastProps) {
  const [visibleEvents, setVisibleEvents] = useState<DecisionEvent[]>([]);

  useEffect(() => {
    // Add new events to visible list
    if (events.length > 0) {
      const latestEvent = events[events.length - 1];
      setVisibleEvents(prev => {
        // Don't add duplicates
        if (prev.some(e => e.id === latestEvent.id)) return prev;
        // Keep only maxVisible events
        const newEvents = [...prev, latestEvent].slice(-maxVisible);
        return newEvents;
      });
    }
  }, [events, maxVisible]);

  const removeEvent = (id: string) => {
    setVisibleEvents(prev => prev.filter(e => e.id !== id));
  };

  if (visibleEvents.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-2 w-72">
      {visibleEvents.map(event => (
        <ToastItem
          key={event.id}
          event={event}
          onDone={() => removeEvent(event.id)}
        />
      ))}
    </div>
  );
}
