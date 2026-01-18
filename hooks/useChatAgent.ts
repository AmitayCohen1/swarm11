'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

interface ProgressUpdate {
  type: 'analyzing' | 'decision' | 'research_started' | 'research_iteration' | 'step_complete' | 'research_complete' | 'message' | 'complete' | 'error' | 'agent_thinking' | 'research_query' | 'plan_created' | 'brain_updated' | 'brain_update' | 'summary_created' | 'needs_clarification' | 'search_result';
  message?: string;
  decision?: string;
  reasoning?: string;
  objective?: string;
  iteration?: number;
  text?: string;
  toolCalls?: any[];
  creditsUsed?: number;
  tokensUsed?: number;
  role?: string;
  metadata?: any;
  // New fields for detailed progress
  thinking?: string;
  query?: string;
  answer?: string;
  sources?: any[];
  toolName?: string;
  plan?: {
    strategy?: string;
    questions?: string[];
    reasoning?: string;
  };
  category?: string;
  findings?: string;
  keyInsights?: string[];
  // Clarification fields
  question?: string;
  context?: string;
  // Brain
  brain?: string;
}

export function useChatAgent() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'initializing' | 'ready' | 'processing' | 'researching' | 'error'>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState<{
    objective?: string;
    iteration?: number;
  }>({});
  const [brain, setBrain] = useState<string>('');
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize chat session
  const initializeSession = async () => {
    setStatus('initializing');
    setError(null);

    try {
      const response = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start chat session');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setStatus('ready');

      // Add welcome message
      setMessages([{
        role: 'assistant',
        content: "Hello! I'm your research assistant. I can help you research topics, answer questions, and gather information. What would you like to explore today?",
        timestamp: new Date().toISOString()
      }]);

    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  // Send message
  const sendMessage = async (userMessage: string) => {
    if (!sessionId || !userMessage.trim()) return;

    setStatus('processing');
    setError(null);
    setIsResearching(false);
    setResearchProgress({});

    // Add user message to UI immediately
    const newUserMessage: Message = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, newUserMessage]);

    try {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      // Use fetch with streaming instead of EventSource (which doesn't support POST)
      const response = await fetch(`/api/chat/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processUpdate = (update: ProgressUpdate) => {
        if (update.type === 'analyzing') {
          setStatus('processing');
        } else if (update.type === 'decision') {
          console.log('Decision:', update.decision, update.reasoning);
        } else if (update.type === 'research_started') {
          setIsResearching(true);
          setStatus('researching');
          setResearchProgress({
            objective: update.objective,
            iteration: 0
          });
        } else if (
          update.type === 'research_query' ||
          update.type === 'search_result' ||
          update.type === 'agent_thinking' ||
          update.type === 'research_iteration'
        ) {
          // Treat activity as messages in the stream
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: update.type,
              ...update
            }
          }]);
        }

        if (update.type === 'research_iteration' || update.type === 'step_complete') {
          setResearchProgress(prev => ({
            ...prev,
            iteration: update.iteration
          }));
        } else if (update.type === 'brain_update') {
          // Update brain content in real-time
          setBrain(update.brain || '');
        } else if (update.type === 'message') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: update.message || '',
            timestamp: new Date().toISOString(),
            metadata: update.metadata
          };
          setMessages(prev => [...prev, assistantMessage]);
          // Don't set isResearching to false here - wait for 'complete' event
        } else if (update.type === 'complete') {
          setStatus('ready');
          setIsResearching(false);
        } else if (update.type === 'error') {
          setError(update.message || 'An error occurred');
          setStatus('error');
          setIsResearching(false);
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = line.substring(6); // Remove 'data: ' prefix
              const update: ProgressUpdate = JSON.parse(data);
              processUpdate(update);
            } catch (err) {
              console.error('Failed to parse SSE message:', err);
            }
          }
        }
      }

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User stopped the run; do not show as an error.
        setStatus('ready');
        setIsResearching(false);
        return;
      }

      setError(err.message);
      setStatus('error');
      setIsResearching(false);
    }
  };

  // Stop research
  const stopResearch = async () => {
    if (!sessionId) return;

    try {
      abortControllerRef.current?.abort();
      await fetch(`/api/chat/${sessionId}/stop`, {
        method: 'POST'
      });

      setIsResearching(false);
      setStatus('ready');
      setResearchProgress({});

    } catch (err: any) {
      console.error('Error stopping research:', err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Auto-initialize on mount
  useEffect(() => {
    if (status === 'idle') {
      initializeSession();
    }
  }, []);

  return {
    sessionId,
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    brain,
    sendMessage,
    stopResearch,
    initializeSession
  };
}
