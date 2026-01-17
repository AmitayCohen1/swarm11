import { useState, useCallback } from 'react';

export interface OrchestratorMessage {
  role: 'user' | 'assistant';
  content: string;
  action?: 'respond' | 'research' | 'clarify';
  researchResult?: any;
  timestamp: Date;
}

export interface UseOrchestratorReturn {
  sessionId: string | null;
  messages: OrchestratorMessage[];
  isLoading: boolean;
  error: string | null;
  creditsUsed: number;
  userCredits: number | null;
  startSession: (initialMessage: string) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  stopSession: () => Promise<void>;
  clearError: () => void;
}

export function useOrchestrator(): UseOrchestratorReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OrchestratorMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState(0);
  const [userCredits, setUserCredits] = useState<number | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const startSession = useCallback(async (initialMessage: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Add user message immediately
      const userMsg: OrchestratorMessage = {
        role: 'user',
        content: initialMessage,
        timestamp: new Date(),
      };
      setMessages([userMsg]);

      const response = await fetch('/api/autonomous/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: initialMessage }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        throw new Error(errorData.error || errorData.details || 'Failed to start session');
      }

      const data = await response.json();

      setSessionId(data.sessionId);
      setCreditsUsed(data.creditsUsed);
      setUserCredits(data.userCredits);

      // Add assistant response
      const assistantMsg: OrchestratorMessage = {
        role: 'assistant',
        content: data.message,
        action: data.action,
        researchResult: data.researchResult,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error starting session:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!sessionId) {
        setError('No active session');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Add user message immediately
        const userMsg: OrchestratorMessage = {
          role: 'user',
          content: message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsg]);

        const response = await fetch(`/api/autonomous/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const data = await response.json();

        setCreditsUsed(data.totalCreditsUsed);
        setUserCredits(data.userCredits);

        // Add assistant response
        const assistantMsg: OrchestratorMessage = {
          role: 'assistant',
          content: data.message,
          action: data.action,
          researchResult: data.researchResult,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('Error sending message:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId]
  );

  const stopSession = useCallback(async () => {
    if (!sessionId) {
      setError('No active session');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
        const response = await fetch(`/api/autonomous/${sessionId}/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to stop session');
      }

      // Clear session
      setSessionId(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error stopping session:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  return {
    sessionId,
    messages,
    isLoading,
    error,
    creditsUsed,
    userCredits,
    startSession,
    sendMessage,
    stopSession,
    clearError,
  };
}
