'use client';

import { useState, useEffect, useRef } from 'react';

interface ProgressUpdate {
  type: 'step_complete' | 'completed' | 'error';
  iteration?: number;
  text?: string;
  toolCalls?: Array<{
    tool: string;
    input: any;
  }>;
  creditsUsed?: number;
  tokensUsed?: number;
  finalReport?: string;
  stopReason?: string;
  totalSteps?: number;
  message?: string;
}

export function useAutonomousAgent() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'completed' | 'error'>('idle');
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [finalReport, setFinalReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const startSession = async (objective: string, maxQueries: number = 20) => {
    setStatus('starting');
    setError(null);
    setUpdates([]);
    setCurrentIteration(0);
    setTotalCredits(0);
    setFinalReport(null);
    setStopReason(null);

    try {
      // Create session
      const response = await fetch('/api/autonomous/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, maxQueries })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start session');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setStatus('running');

      // Connect to SSE stream
      const eventSource = new EventSource(`/api/autonomous/${data.sessionId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const update: ProgressUpdate = JSON.parse(event.data);

          setUpdates(prev => [...prev, update]);

          if (update.type === 'step_complete') {
            setCurrentIteration(update.iteration || 0);
            setTotalCredits(prev => prev + (update.creditsUsed || 0));
          } else if (update.type === 'completed') {
            setFinalReport(update.finalReport || null);
            setStopReason(update.stopReason || null);
            setStatus('completed');
            eventSource.close();
          } else if (update.type === 'error') {
            setError(update.message || 'Unknown error');
            setStatus('error');
            eventSource.close();
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      };

      eventSource.onerror = () => {
        setError('Connection lost');
        setStatus('error');
        eventSource.close();
      };

    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  const stopSession = async () => {
    if (!sessionId) return;

    try {
      await fetch(`/api/autonomous/${sessionId}/stop`, {
        method: 'POST'
      });

      eventSourceRef.current?.close();
      setStatus('completed');
      setStopReason('user_stopped');
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return {
    sessionId,
    status,
    updates,
    currentIteration,
    totalCredits,
    finalReport,
    error,
    stopReason,
    startSession,
    stopSession
  };
}
