'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

interface ProgressUpdate {
  type: 'analyzing' | 'decision' | 'research_started' | 'research_iteration' | 'step_complete' | 'research_complete' | 'message' | 'complete' | 'error' | 'agent_thinking' | 'research_query' | 'list_updated' | 'brain_updated' | 'brain_update' | 'summary_created' | 'needs_clarification' | 'search_result' | 'search_completed' | 'ask_user' | 'search_started' | 'multi_choice_select' | 'reasoning_started' | 'synthesizing_started';
  options?: { label: string; description?: string }[];
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
  thinking?: string;
  query?: string;
  answer?: string;
  sources?: any[];
  toolName?: string;
  list?: string[];
  action?: string;
  category?: string;
  findings?: string;
  keyInsights?: string[];
  question?: string;
  context?: string;
  brain?: string;
}

interface UseChatAgentOptions {
  existingSessionId?: string;
}

export function useChatAgent(options: UseChatAgentOptions = {}) {
  const { existingSessionId } = options;
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId || null);
  const [status, setStatus] = useState<'idle' | 'initializing' | 'ready' | 'processing' | 'researching' | 'error'>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState<{
    objective?: string;
    stoppingConditions?: string;
    successCriteria?: string;
    iteration?: number;
  }>({});
  const [brain, setBrain] = useState<string>('');
  const [explorationList, setExplorationList] = useState<string[] | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingBatchRef = useRef<any[] | null>(null);

  // Load existing session
  const loadExistingSession = useCallback(async (id: string) => {
    setStatus('initializing');
    setError(null);

    try {
      const response = await fetch(`/api/chat/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
          // Session not found, redirect to new chat
          router.replace('/chat');
          return;
        }
        throw new Error('Failed to load session');
      }

      const data = await response.json();
      const session = data.session;

      setSessionId(session.id);
      setMessages(session.messages || []);
      setBrain(session.brain || '');
      setIsResearching(session.status === 'researching');
      setStatus('ready');

    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  }, [router]);

  // Initialize new chat session
  const initializeNewSession = useCallback(async () => {
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

      // Update URL to include session ID (shallow - no remount)
      window.history.replaceState(window.history.state, '', `/chat/${data.sessionId}`);

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
  }, []);

  // Send message
  const sendMessage = async (userMessage: string) => {
    if (!sessionId || !userMessage.trim()) return;

    setStatus('processing');
    setError(null);
    setIsResearching(false);
    setResearchProgress({});
    setExplorationList(null);

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
          const brief = (update as any).brief;
          setResearchProgress({
            objective: update.objective,
            stoppingConditions: brief?.stoppingConditions,
            successCriteria: brief?.successCriteria,
            iteration: 0
          });
        } else if (update.type === 'search_started') {
          const queries = (update as any).queries.map((q: any) => ({
            query: q.query,
            purpose: q.purpose,
            status: 'searching',
            answer: null,
            sources: []
          }));
          pendingBatchRef.current = queries;

          setMessages(prev => {
            const lastBatch = prev.findLast(m => m.metadata?.type === 'search_batch');
            if (lastBatch?.metadata?.queries?.[0]?.status === 'complete') {
              return prev;
            }
            return [...prev, {
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'search_batch',
                queries
              }
            }];
          });
        } else if (update.type === 'search_completed') {
          const completedQueries = (update as any).queries || [];
          pendingBatchRef.current = null;

          setMessages(prev => {
            const batchIdx = prev.findLastIndex(m =>
              m.metadata?.type === 'search_batch' &&
              m.metadata?.queries?.[0]?.status === 'searching'
            );

            if (batchIdx !== -1) {
              const newMessages = [...prev];
              newMessages[batchIdx] = {
                ...newMessages[batchIdx],
                metadata: {
                  type: 'search_batch',
                  queries: completedQueries
                }
              };
              return newMessages;
            }

            return [...prev, {
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'search_batch',
                queries: completedQueries
              }
            }];
          });
        } else if (update.type === 'ask_user') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'ask_user',
              question: update.question,
              options: update.options
            }
          }]);
        } else if (update.type === 'multi_choice_select') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'multi_choice_select',
              question: update.question,
              options: update.options,
              reason: (update as any).reason
            }
          }]);
        } else if (update.type === 'reasoning_started') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { type: 'reasoning_started' }
          }]);
        } else if (update.type === 'synthesizing_started') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { type: 'synthesizing_started' }
          }]);
        } else if (update.type === 'agent_thinking') {
          setMessages(prev => {
            const reasoningIdx = prev.findLastIndex(m => m.metadata?.type === 'reasoning_started');
            if (reasoningIdx !== -1) {
              const newMessages = [...prev];
              newMessages[reasoningIdx] = {
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString(),
                metadata: { ...update }
              };
              return newMessages;
            }
            return [...prev, {
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              metadata: { ...update }
            }];
          });
        } else if (update.type === 'research_iteration') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { ...update }
          }]);
        }

        if (update.type === 'research_iteration' || update.type === 'step_complete') {
          setResearchProgress(prev => ({
            ...prev,
            iteration: update.iteration
          }));
        } else if (update.type === 'brain_update') {
          setBrain(update.brain || '');
        } else if (update.type === 'list_updated') {
          setExplorationList(update.list || null);
        } else if (update.type === 'message') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: update.message || '',
            timestamp: new Date().toISOString(),
            metadata: update.metadata
          };
          setMessages(prev => [...prev, assistantMessage]);
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

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = line.substring(6);
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

  // Initialize on mount
  useEffect(() => {
    if (status === 'idle') {
      if (existingSessionId) {
        loadExistingSession(existingSessionId);
      } else {
        initializeNewSession();
      }
    }
  }, [status, existingSessionId, loadExistingSession, initializeNewSession]);

  return {
    sessionId,
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    explorationList,
    brain,
    sendMessage,
    stopResearch,
    initializeSession: initializeNewSession
  };
}
