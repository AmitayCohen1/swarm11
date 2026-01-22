'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

// V4 Document-centric types - Item-based sections
interface SectionItem {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
}

interface Section {
  id: string;
  title: string;
  items: SectionItem[];
}

interface Strategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

interface ResearchDoc {
  objective: string;
  doneWhen: string;
  sections: Section[];
  strategy: Strategy;
}

interface ProgressUpdate {
  type: string;
  options?: { label: string; description?: string }[];
  message?: string;
  decision?: string;
  reasoning?: string;
  objective?: string;
  doneWhen?: string;
  iteration?: number;
  text?: string;
  creditsUsed?: number;
  tokensUsed?: number;
  metadata?: any;
  query?: string;
  answer?: string;
  sources?: any[];
  reflection?: string;
  action?: string;
  question?: string;
  brain?: string;
  phase?: string;
  searchCount?: number;
  isDone?: boolean;
  verdict?: string;
  critique?: string;
  missing?: string[];
  urls?: string[];
  purpose?: string;
  results?: any[];
  failed?: any[];
  doc?: ResearchDoc;
  sectionTitle?: string;
  section?: Section;
  sectionsUpdated?: number;
  strategy?: Strategy;
  version?: number;
  shouldContinue?: boolean;
  task?: string;
  summary?: string;
  totalSearches?: number;
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
  const [researchDoc, setResearchDoc] = useState<ResearchDoc | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isResearchingRef = useRef(false);

  useEffect(() => {
    isResearchingRef.current = isResearching;
  }, [isResearching]);

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

  // Load existing session
  const loadExistingSession = useCallback(async (id: string) => {
    setStatus('initializing');
    setError(null);

    try {
      const response = await fetch(`/api/chat/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
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

      // Parse brain to extract document
      if (session.brain) {
        try {
          const parsed = JSON.parse(session.brain);
          if (parsed.version === 4) {
            setResearchDoc({
              objective: parsed.objective,
              doneWhen: parsed.doneWhen,
              sections: parsed.sections,
              strategy: parsed.strategy
            });
            setResearchProgress({
              objective: parsed.objective,
              doneWhen: parsed.doneWhen
            });
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

      window.history.replaceState(window.history.state, '', `/chat/${data.sessionId}`);

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
  const sendMessage = async (userMessage: string, options?: { skipUserBubble?: boolean }) => {
    if (!sessionId || !userMessage.trim()) return;

    setStatus('processing');
    setError(null);
    setStage(null);

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

        // Document updates
        if (update.type === 'doc_updated') {
          if (update.doc) {
            setResearchDoc(update.doc);
            setResearchProgress({
              objective: update.doc.objective,
              doneWhen: update.doc.doneWhen
            });
          }
          addEvent('doc_updated', 'Document updated', `${update.sectionsUpdated || 0} sections updated`, 'info');
        }

        if (update.type === 'section_updated') {
          addEvent('section_updated', `${update.sectionTitle} updated`, undefined, 'log');
        }

        if (update.type === 'iteration_started') {
          addEvent('iteration_started', `Iteration ${update.iteration}`, update.action as any, 'phase');
        }

        if (update.type === 'reflection_started') {
          setStage('reflecting');
          addEvent('reflection_started', 'Analyzing findings', 'Deciding what to add to document...', 'reflect');
        }

        if (update.type === 'reflection_completed') {
          setStage(null);
          addEvent('reflection_completed', 'Reflection complete', `${update.sectionsUpdated || 0} sections`, 'reflect');

          if (update.reasoning) {
            setMessages(prev => [...prev, {
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'reasoning',
                reflection: update.reasoning
              }
            }]);
          }
        }

        if (update.type === 'search_agent_started') {
          addEvent('search_agent_started', 'Search agent started', update.task as any, 'search');
        }

        if (update.type === 'search_agent_completed') {
          addEvent('search_agent_completed', 'Search agent complete', update.summary as any, 'search');
        }

        if (update.type === 'research_initialized') {
          addEvent('research_initialized', 'Research initialized', `Objective: ${update.objective?.substring(0, 40)}...`, 'info');
        }

        if (update.type === 'phase_change') {
          addEvent('phase_change', `Phase: ${update.phase}`, undefined, 'phase');
        }

        if (update.type === 'review_started') {
          addEvent('review_started', 'Reviewing research', 'Checking if DONE_WHEN is satisfied...', 'reflect');
        }

        if (update.type === 'review_completed') {
          const verdict = update.verdict || 'unknown';
          const icon = verdict === 'pass' ? 'complete' : 'error';
          addEvent('review_completed', `Review: ${verdict.toUpperCase()}`, update.critique?.substring(0, 60), icon as any);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'review_result',
              verdict: update.verdict,
              critique: update.critique,
              missing: update.missing
            }
          }]);
        }

        if (update.type === 'review_rejected') {
          addEvent('review_rejected', 'Review FAILED', `Missing: ${(update.missing || []).join(', ').substring(0, 50)}`, 'error');
        }

        if (update.type === 'research_complete') {
          addEvent('research_complete', 'Research complete', `${update.totalSearches} searches`, 'complete');
        }

        if (update.type === 'analyzing') {
          setStatus('processing');
          addEvent('analyzing', 'Analyzing message', 'Understanding your request...', 'info');
        }

        if (update.type === 'decision') {
          addEvent('decision', `Decision: ${update.decision}`, update.reasoning, 'info');
        }

        if (update.type === 'research_started') {
          setEventLog([]);
          setResearchDoc(null);
          setIsResearching(true);
          setStatus('researching');
          setResearchProgress({
            objective: update.objective,
            doneWhen: update.doneWhen,
            iteration: 0
          });
          addEvent('research_started', 'Research started', update.objective?.substring(0, 50) + '...', 'info');
        }

        if (update.type === 'search_started') {
          setStage('searching');
          addEvent('search_started', 'Searching...', '', 'search');
        }

        if (update.type === 'search_completed') {
          setStage(null);
          const completedQueries = (update as any).queries || [];
          addEvent('search_completed', `Search complete`, `${completedQueries.length} results`, 'search');

          if (completedQueries.length > 0) {
            setMessages(prev => [...prev, {
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                type: 'search_batch',
                queries: completedQueries
              }
            }]);
          }
        }

        if (update.type === 'extract_started') {
          setStage('searching');
          addEvent('extract_started', `Extracting (${(update.urls || []).length} URLs)`, update.purpose || '', 'search');
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            content: '',
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'extract_batch',
              urls: update.urls,
              purpose: update.purpose,
              status: 'extracting',
              results: []
            }
          }]);
        }

        if (update.type === 'extract_completed') {
          setStage(null);
          addEvent('extract_completed', `Extract complete`, `${(update.results || []).length} pages extracted`, 'search');
          setMessages(prev => {
            const batchIdx = prev.findLastIndex(m =>
              m.metadata?.type === 'extract_batch' && m.metadata?.status === 'extracting'
            );
            if (batchIdx !== -1) {
              const newMessages = [...prev];
              newMessages[batchIdx] = {
                ...newMessages[batchIdx],
                metadata: {
                  type: 'extract_batch',
                  purpose: update.purpose,
                  status: 'complete',
                  results: update.results,
                  failed: update.failed
                }
              };
              return newMessages;
            }
            return prev;
          });
        }

        if (update.type === 'ask_user') {
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
        }

        if (update.type === 'multi_choice_select') {
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
        }

        if (update.type === 'reasoning_started') {
          setStage('reflecting');
          addEvent('reasoning_started', 'Reflecting', 'Analyzing what was learned...', 'reflect');
        }

        if (update.type === 'synthesizing_started') {
          setStage('synthesizing');
          addEvent('synthesizing_started', 'Synthesizing', 'Writing final answer...', 'complete');
        }

        if (update.type === 'research_iteration') {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { ...update }
          }]);
          setResearchProgress(prev => ({
            ...prev,
            iteration: update.iteration
          }));
        }

        if (update.type === 'brain_update') {
          setBrain(update.brain || '');
          if (update.brain) {
            try {
              const parsed = JSON.parse(update.brain);
              if (parsed.version === 4) {
                setResearchDoc({
                  objective: parsed.objective,
                  doneWhen: parsed.doneWhen,
                  sections: parsed.sections,
                  strategy: parsed.strategy
                });
              }
            } catch {
              // Invalid JSON
            }
          }
        }

        if (update.type === 'reasoning') {
          setStage(null);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            metadata: { type: 'reasoning', reflection: update.reflection }
          }]);
        }

        if (update.type === 'message') {
          const assistantMessage: Message = {
            role: 'assistant',
            content: update.message || '',
            timestamp: new Date().toISOString(),
            metadata: update.metadata
          };
          setMessages(prev => [...prev, assistantMessage]);
        }

        if (update.type === 'complete') {
          setStatus('ready');
          setIsResearching(false);
          setStage(null);
        }

        if (update.type === 'error') {
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
      await fetch(`/api/chat/${sessionId}/stop`, { method: 'POST' });
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
    researchDoc,
    brain,
    stage,
    eventLog,
    sendMessage,
    stopResearch,
    initializeSession: initializeNewSession
  };
}
