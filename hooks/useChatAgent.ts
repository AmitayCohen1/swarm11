'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

// V3 Document-centric types
interface SectionItem {
  id: string;
  text: string;
  sources?: { url: string; title: string }[];
}

interface Section {
  id: string;
  title: string;
  items: SectionItem[];
  lastUpdated: string;
}

interface Strategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

interface ResearchDoc {
  northStar: string;
  currentObjective: string;
  doneWhen: string;
  sections: Section[];
  strategy: Strategy;
}

// Legacy V2 types (for backwards compatibility)
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
  type: 'analyzing' | 'decision' | 'research_started' | 'research_iteration' | 'step_complete' | 'research_complete' | 'message' | 'complete' | 'error' | 'agent_thinking' | 'research_query' | 'brain_updated' | 'brain_update' | 'summary_created' | 'needs_clarification' | 'search_result' | 'search_completed' | 'ask_user' | 'search_started' | 'multi_choice_select' | 'reasoning_started' | 'synthesizing_started' | 'reasoning' | 'phase_change' | 'research_initialized' | 'log_entry_added' | 'extract_started' | 'extract_completed' | 'review_started' | 'review_completed' | 'review_rejected' | 'working_memory_updated' | 'doc_updated' | 'section_updated' | 'iteration_started' | 'reflection_started' | 'reflection_completed' | 'search_agent_started' | 'search_agent_completed';
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
  // Legacy log entry
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
  // V3 document-specific
  doc?: ResearchDoc;
  sectionTitle?: string;
  section?: Section;
  editsApplied?: number;
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

  // V3: Document-centric state
  const [researchDoc, setResearchDoc] = useState<ResearchDoc | null>(null);

  // Legacy V2 state (for backwards compatibility)
  const [researchLog, setResearchLog] = useState<LogEntry[]>([]);
  const [doneWhen, setDoneWhen] = useState<string | null>(null);
  const [workingMemory, setWorkingMemory] = useState<WorkingMemory | null>(null);

  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

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
  const isResearchingRef = useRef(false);

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

      // Parse brain to extract document or legacy log
      if (session.brain) {
        try {
          const parsed = JSON.parse(session.brain);

          // V3: Document-centric format
          if (parsed.version === 3) {
            setResearchDoc({
              northStar: parsed.northStar,
              currentObjective: parsed.currentObjective,
              doneWhen: parsed.doneWhen,
              sections: parsed.sections,
              strategy: parsed.strategy
            });
            setDoneWhen(parsed.doneWhen || null);
            setResearchProgress({
              objective: parsed.currentObjective,
              doneWhen: parsed.doneWhen
            });
            // Clear legacy state
            setResearchLog([]);
            setWorkingMemory(null);
          }
          // V2: Legacy log-based format
          else if (parsed.version === 2) {
            setResearchLog(parsed.log || []);
            setDoneWhen(parsed.doneWhen || null);
            setResearchProgress({
              objective: parsed.objective,
              doneWhen: parsed.doneWhen
            });
            if (parsed.workingMemory) {
              setWorkingMemory(parsed.workingMemory);
            }
            // Clear V3 state
            setResearchDoc(null);
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

        // ==========================================
        // V3: Document-centric events
        // ==========================================

        if (update.type === 'doc_updated') {
          if (update.doc) {
            setResearchDoc(update.doc);
            // Also update legacy state for compatibility
            setDoneWhen(update.doc.doneWhen);
            setResearchProgress({
              objective: update.doc.currentObjective,
              doneWhen: update.doc.doneWhen
            });
          }
          addEvent('doc_updated', 'Document updated', `${update.editsApplied || 0} edits applied`, 'info');
        }

        if (update.type === 'section_updated') {
          addEvent('section_updated', `${update.sectionTitle} updated`, update.action, 'log');
          // The doc_updated event will handle the full state update
        }

        if (update.type === 'iteration_started') {
          addEvent('iteration_started', `Iteration ${update.iteration}`, update.action, 'phase');
        }

        if (update.type === 'reflection_started') {
          setStage('reflecting');
          addEvent('reflection_started', 'Analyzing findings', 'Deciding what to add to document...', 'reflect');
        }

        if (update.type === 'reflection_completed') {
          setStage(null);
          addEvent('reflection_completed', 'Reflection complete', `${update.editsApplied || 0} edits`, 'reflect');

          // Show reasoning in chat if available
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

        // ==========================================
        // Legacy and shared events
        // ==========================================

        if (update.type === 'research_initialized') {
          const version = update.version || 2;
          addEvent('research_initialized', `Research initialized (v${version})`, `Objective: ${update.objective?.substring(0, 40)}...`, 'info');

          // Initialize appropriate state based on version
          if (version === 3 && update.doc) {
            setResearchDoc(update.doc);
            setResearchLog([]);
            setWorkingMemory(null);
          }
        }

        if (update.type === 'phase_change') {
          const phase = update.phase || 'unknown';
          addEvent('phase_change', `Phase: ${phase}`, undefined, 'phase');
        }

        // Legacy V2: log_entry_added
        if (update.type === 'log_entry_added') {
          const entry = update.entry;
          addEvent('log_entry_added', `Logged: ${entry?.method?.substring(0, 30)}...`, entry?.insight?.substring(0, 50), 'log');
          if (update.entry) {
            setResearchLog(prev => [...prev, update.entry!]);
          }
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
          const missing = update.missing || [];
          addEvent('review_rejected', 'Review FAILED', `Missing: ${missing.join(', ').substring(0, 50)}`, 'error');
        }

        if (update.type === 'research_complete') {
          const sequence = update.toolSequence || [];
          addEvent('research_complete', 'Research complete', sequence.length > 0 ? `Sequence: ${sequence.join(' → ')}` : `${update.totalSearches} searches`, 'complete');
        }

        if (update.type === 'analyzing') {
          setStatus('processing');
          addEvent('analyzing', 'Analyzing message', 'Understanding your request...', 'info');
        }

        if (update.type === 'decision') {
          console.log('Decision:', update.decision, update.reasoning);
          addEvent('decision', `Decision: ${update.decision}`, update.reasoning, 'info');
        }

        if (update.type === 'research_started') {
          setEventLog([]);
          setResearchLog([]);
          setResearchDoc(null);
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
        }

        if (update.type === 'search_started') {
          // Just set stage, don't create messages yet
          setStage('searching');
          addEvent('search_started', 'Searching...', '', 'search');
        }

        if (update.type === 'search_completed') {
          setStage(null);
          const completedQueries = (update as any).queries || [];
          addEvent('search_completed', `Search complete`, `${completedQueries.length} results`, 'search');

          // Only create message if we have actual results
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
        }

        if (update.type === 'extract_completed') {
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

              // V3: Document-centric
              if (parsed.version === 3) {
                setResearchDoc({
                  northStar: parsed.northStar,
                  currentObjective: parsed.currentObjective,
                  doneWhen: parsed.doneWhen,
                  sections: parsed.sections,
                  strategy: parsed.strategy
                });
                setDoneWhen(parsed.doneWhen);
                // Clear legacy state
                setResearchLog([]);
                setWorkingMemory(null);
              }
              // V2: Legacy
              else if (parsed.version === 2 && parsed.log) {
                setResearchLog(parsed.log);
                if (parsed.doneWhen) {
                  setDoneWhen(parsed.doneWhen);
                }
                if (parsed.workingMemory) {
                  setWorkingMemory(parsed.workingMemory);
                }
                // Clear V3 state
                setResearchDoc(null);
              }
            } catch {
              // Invalid JSON
            }
          }
        }

        // Legacy V2: working_memory_updated
        if (update.type === 'working_memory_updated') {
          const bullets = (update as any).bullets || [];
          const lastUpdated = (update as any).lastUpdated || new Date().toISOString();
          setWorkingMemory({ bullets, lastUpdated });
          addEvent('working_memory_updated', 'Memory updated', `${bullets.length} conclusions`, 'info');
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
    // V3: Document-centric
    researchDoc,
    // Legacy V2 (for backwards compatibility)
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
