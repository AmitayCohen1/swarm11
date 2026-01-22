'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  signal: string;
  insight: string;
  progressTowardObjective: string;
  mood: 'exploring' | 'promising' | 'dead_end' | 'breakthrough';
  sources: { url: string; title: string }[];
}

interface WorkingMemory {
  bullets: string[];
  lastUpdated: string;
}

interface ProgressUpdate {
  type: 'analyzing' | 'decision' | 'research_started' | 'research_iteration' | 'step_complete' | 'research_complete' | 'message' | 'complete' | 'error' | 'agent_thinking' | 'research_query' | 'brain_updated' | 'brain_update' | 'summary_created' | 'needs_clarification' | 'search_result' | 'search_completed' | 'ask_user' | 'search_started' | 'multi_choice_select' | 'reasoning_started' | 'synthesizing_started' | 'reasoning' | 'phase_change' | 'research_initialized' | 'log_entry_added' | 'extract_started' | 'extract_completed' | 'review_started' | 'review_completed' | 'review_rejected' | 'working_memory_updated';
  options?: { label: string; description?: string }[];
  message?: string;
  decision?: string;
  reasoning?: string;
  objective?: string;
  doneWhen?: string;
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
  reflection?: string;
  action?: string;
  category?: string;
  findings?: string;
  keyInsights?: string[];
  question?: string;
  context?: string;
  brain?: string;
  phase?: string;
  searchCount?: number;
  toolSequence?: string[];
  // Log entry
  entry?: LogEntry;
  logCount?: number;
  isDone?: boolean;
  // Review-specific
  verdict?: string;
  critique?: string;
  missing?: string[];
  // Extract-specific
  urls?: string[];
  purpose?: string;
  results?: any[];
  failed?: any[];
}

// Event log entry for UI display
export interface EventLogEntry {
  id: string;
  type: string;
  timestamp: string;
  label: string;
  detail?: string;
  icon: 'plan' | 'search' | 'reflect' | 'phase' | 'complete' | 'error' | 'info' | 'log';
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
    doneWhen?: string;
    iteration?: number;
  }>({});
  const [brain, setBrain] = useState<string>('');
  const [stage, setStage] = useState<'searching' | 'reflecting' | 'synthesizing' | null>(null);
  const [researchLog, setResearchLog] = useState<LogEntry[]>([]);
  const [doneWhen, setDoneWhen] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [workingMemory, setWorkingMemory] = useState<WorkingMemory | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Helper to add event to log
  const addEvent = useCallback((type: string, label: string, detail?: string, icon: EventLogEntry['icon'] = 'info') => {
    const entry: EventLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: new Date().toISOString(),
      label,
      detail,
      icon
    };
    setEventLog(prev => [...prev, entry]);
  }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingBatchRef = useRef<any[] | null>(null);
  const isResearchingRef = useRef(false); // Ref to avoid stale closure in sendMessage

  // Keep ref in sync with state
  useEffect(() => {
    isResearchingRef.current = isResearching;
  }, [isResearching]);

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

      // Parse brain to extract log, doneWhen, and workingMemory
      if (session.brain) {
        try {
          const parsed = JSON.parse(session.brain);
          if (parsed.version === 2) {
            setResearchLog(parsed.log || []);
            setDoneWhen(parsed.doneWhen || null);
            setResearchProgress({
              objective: parsed.objective,
              doneWhen: parsed.doneWhen
            });
            // Parse working memory
            if (parsed.workingMemory) {
              setWorkingMemory(parsed.workingMemory);
            }
          }
        } catch {
          // Invalid brain JSON
        }
      }

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
  // skipUserBubble: when true, don't add user message to chat (used for option selections)
  const sendMessage = async (userMessage: string, options?: { skipUserBubble?: boolean }) => {
    if (!sessionId || !userMessage.trim()) return;

    setStatus('processing');
    setError(null);
    // Don't clear research state here - it's cleared in research_started event
    // This prevents flickering when chatting with orchestrator
    setStage(null);

    // Add user message to UI immediately (unless it's an option selection)
    if (!options?.skipUserBubble) {
      const newUserMessage: Message = {
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, newUserMessage]);
    }

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
        console.log('[SSE Event]', update.type, update);

        // Log events for visibility
        if (update.type === 'research_initialized') {
          addEvent('research_initialized', 'Research initialized', `Objective: ${update.objective?.substring(0, 40)}...`, 'info');
        } else if (update.type === 'phase_change') {
          const phase = update.phase || 'unknown';
          addEvent('phase_change', `Phase: ${phase}`, undefined, 'phase');
        } else if (update.type === 'log_entry_added') {
          const entry = update.entry;
          addEvent('log_entry_added', `Logged: ${entry?.method?.substring(0, 30)}...`, entry?.insight?.substring(0, 50), 'log');
        } else if (update.type === 'review_completed') {
          const verdict = update.verdict || 'unknown';
          const icon = verdict === 'pass' ? 'complete' : 'error';
          addEvent('review_completed', `Review: ${verdict.toUpperCase()}`, update.critique?.substring(0, 60), icon as any);
        } else if (update.type === 'review_rejected') {
          const missing = update.missing || [];
          addEvent('review_rejected', 'Review FAILED', `Missing: ${missing.join(', ').substring(0, 50)}`, 'error');
        } else if (update.type === 'research_complete') {
          const sequence = update.toolSequence || [];
          addEvent('research_complete', 'Research complete', `Sequence: ${sequence.join(' → ')}`, 'complete');
        }

        if (update.type === 'analyzing') {
          setStatus('processing');
          addEvent('analyzing', 'Analyzing message', 'Understanding your request...', 'info');
        } else if (update.type === 'decision') {
          console.log('Decision:', update.decision, update.reasoning);
          addEvent('decision', `Decision: ${update.decision}`, update.reasoning, 'info');
        } else if (update.type === 'research_started') {
          // Clear event log for new research session
          setEventLog([]);
          setResearchLog([]);
          setDoneWhen(null);
          setWorkingMemory(null);
          setIsResearching(true);
          setStatus('researching');
          setResearchProgress({
            objective: update.objective,
            doneWhen: update.doneWhen,
            iteration: 0
          });
          addEvent('research_started', 'Research started', update.objective?.substring(0, 50) + '...', 'info');
        } else if (update.type === 'research_initialized') {
          // Set doneWhen when research initializes
          if (update.doneWhen) {
            setDoneWhen(update.doneWhen);
          }
          setResearchProgress({
            objective: update.objective,
            doneWhen: update.doneWhen,
            iteration: 0
          });
        } else if (update.type === 'search_started') {
          const rawQueries = (update as any).queries || [];
          console.log('[search_started] Adding search batch with queries:', rawQueries);
          addEvent('search_started', `Search (${rawQueries.length} queries)`, rawQueries.map((q: any) => q.query).join(' | ').substring(0, 60) + '...', 'search');
          setStage('searching');
          const queries = rawQueries.map((q: any) => ({
            query: q.query,
            purpose: q.purpose,
            status: 'searching',
            answer: null,
            sources: []
          }));
          pendingBatchRef.current = queries;

          setMessages(prev => {
            console.log('[search_started] Adding message, prev count:', prev.length);
            // Always add a new search batch - each search gets its own message
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
          setStage(null);
          const completedQueries = (update as any).queries || [];
          pendingBatchRef.current = null;
          addEvent('search_completed', `Search complete`, `${completedQueries.length} results received`, 'search');

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
        } else if (update.type === 'extract_started') {
          setStage('searching');
          const urls = update.urls || [];
          addEvent('extract_started', `Extracting (${urls.length} URLs)`, update.purpose || '', 'search');

          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'extract_batch',
              urls,
              purpose: update.purpose,
              status: 'extracting',
              results: []
            }
          }]);
        } else if (update.type === 'extract_completed') {
          setStage(null);
          const results = update.results || [];
          const failed = update.failed || [];
          addEvent('extract_completed', `Extract complete`, `${results.length} pages extracted`, 'search');

          setMessages(prev => {
            const batchIdx = prev.findLastIndex(m =>
              m.metadata?.type === 'extract_batch' &&
              m.metadata?.status === 'extracting'
            );

            if (batchIdx !== -1) {
              const newMessages = [...prev];
              newMessages[batchIdx] = {
                ...newMessages[batchIdx],
                metadata: {
                  type: 'extract_batch',
                  purpose: update.purpose,
                  status: 'complete',
                  results,
                  failed
                }
              };
              return newMessages;
            }

            return [...prev, {
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'extract_batch',
                purpose: update.purpose,
                status: 'complete',
                results,
                failed
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
          setStage('reflecting');
          addEvent('reasoning_started', 'Reflecting', 'Analyzing what was learned...', 'reflect');
        } else if (update.type === 'synthesizing_started') {
          setStage('synthesizing');
          addEvent('synthesizing_started', 'Synthesizing', 'Writing final answer...', 'complete');
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
          // Parse brain to extract log and working memory
          if (update.brain) {
            try {
              const parsed = JSON.parse(update.brain);
              if (parsed.version === 2 && parsed.log) {
                setResearchLog(parsed.log);
                if (parsed.doneWhen) {
                  setDoneWhen(parsed.doneWhen);
                }
                // Parse working memory
                if (parsed.workingMemory) {
                  setWorkingMemory(parsed.workingMemory);
                }
              }
            } catch {
              // Invalid JSON
            }
          }
        } else if (update.type === 'working_memory_updated') {
          // Direct update of working memory (more efficient than parsing brain)
          const bullets = (update as any).bullets || [];
          const lastUpdated = (update as any).lastUpdated || new Date().toISOString();
          setWorkingMemory({ bullets, lastUpdated });
          addEvent('working_memory_updated', 'Memory updated', `${bullets.length} conclusions`, 'info');
        } else if (update.type === 'log_entry_added') {
          // Update research log with new entry
          if (update.entry) {
            setResearchLog(prev => [...prev, update.entry!]);
          }
        } else if (update.type === 'reasoning') {
          setStage(null);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { type: 'reasoning', reflection: update.reflection }
          }]);
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
          setStage(null);
        } else if (update.type === 'error') {
          setError(update.message || 'An error occurred');
          setStatus('error');
          setIsResearching(false);
          setStage(null);
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
    researchLog,
    doneWhen,
    workingMemory,
    brain,
    stage,
    eventLog,
    sendMessage,
    stopResearch,
    initializeSession: initializeNewSession
  };
}
