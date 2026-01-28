'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';

interface ResearchStatus {
  isRunning: boolean;
  isComplete: boolean;
  isStopped: boolean;
  status: 'idle' | 'running' | 'complete' | 'stopped';
  progress: {
    total: number;
    done: number;
    running: number;
    pending: number;
  };
}

const ResearchStatusContext = createContext<ResearchStatus>({
  isRunning: false,
  isComplete: false,
  isStopped: false,
  status: 'idle',
  progress: { total: 0, done: 0, running: 0, pending: 0 },
});

export function useResearchStatus() {
  return useContext(ResearchStatusContext);
}

interface ProviderProps {
  children: ReactNode;
  researchDoc: {
    status: 'running' | 'complete' | 'stopped';
    nodes: Record<string, { status: string }>;
  } | null;
}

export function ResearchStatusProvider({ children, researchDoc }: ProviderProps) {
  const value = useMemo<ResearchStatus>(() => {
    if (!researchDoc) {
      return {
        isRunning: false,
        isComplete: false,
        isStopped: false,
        status: 'idle',
        progress: { total: 0, done: 0, running: 0, pending: 0 },
      };
    }

    const nodes = Object.values(researchDoc.nodes);
    const done = nodes.filter(n => n.status === 'done').length;
    const running = nodes.filter(n => n.status === 'running').length;
    const pending = nodes.filter(n => n.status === 'pending').length;

    return {
      isRunning: researchDoc.status === 'running',
      isComplete: researchDoc.status === 'complete',
      isStopped: researchDoc.status === 'stopped',
      status: researchDoc.status,
      progress: {
        total: nodes.length,
        done,
        running,
        pending,
      },
    };
  }, [researchDoc]);

  return (
    <ResearchStatusContext.Provider value={value}>
      {children}
    </ResearchStatusContext.Provider>
  );
}
