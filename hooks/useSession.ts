'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

// BrainDoc types - ResearchQuestion-based research
interface Finding {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
  status?: 'active' | 'disqualified';
  disqualifyReason?: string;
}

interface Search {
  query: string;
  answer: string;
  learned?: string;
  nextAction?: string;
  sources: { url: string; title?: string }[];
}

interface CycleReflection {
  cycle: number;
  learned: string;
  nextStep: string;
  status: 'continue' | 'done';
}

interface ResearchQuestion {
  id: string;
  name: string;
  question: string;
  goal: string;
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;
  findings: Finding[];
  searches?: Search[];
  reflections?: CycleReflection[];
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;
}

interface BrainDecision {
  id: string;
  timestamp: string;
  action: 'spawn' | 'drill_down' | 'kill' | 'synthesize';
  questionId?: string;
  reasoning: string;
}

interface BrainDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  questions: ResearchQuestion[];
  brainLog: BrainDecision[];
  status: 'running' | 'synthesizing' | 'complete';
  finalAnswer?: string;
}

interface ProgressUpdate {
  type: string;
  options?: { label: string; description?: string }[];
  message?: string;
  decision?: string;
  reasoning?: string;
  objective?: string;
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
  questionId?: string;
  findingId?: string;
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
  doc?: BrainDoc;
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

interface UseSessionOptions {
  existingSessionId?: string;
}

export function useSession(options: UseSessionOptions = {}) {
  const { existingSessionId } = options;
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId || null);
  const [status, setStatus] = useState<'idle' | 'initializing' | 'ready' | 'processing' | 'researching' | 'error'>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [researchProgress, setResearchProgress] = useState<{
    objective?: string;
    iteration?: number;
  }>({});
  const [brain, setBrain] = useState<string>('');
  const [stage, setStage] = useState<'searching' | 'reflecting' | 'synthesizing' | null>(null);
  const [researchDoc, setResearchDoc] = useState<BrainDoc | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [intakeSearch, setIntakeSearch] = useState<{ query: string; answer?: string; status: 'searching' | 'complete' } | null>(null);

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
      const response = await fetch(`/api/sessions/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
          router.replace('/sessions/new');
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
          // BrainDoc (version 1)
          if (parsed.version === 1) {
            setResearchDoc(parsed as BrainDoc);
            setResearchProgress({
              objective: parsed.objective
            });
            // Add anchor message for ResearchProgress if not already present
            // Always add anchor for valid brain doc - ResearchProgress handles empty states
            const loadedMessages = session.messages || [];
            const hasAnchor = loadedMessages.some((m: Message) => m.metadata?.type === 'research_progress');
            if (!hasAnchor) {
              setMessages([
                ...loadedMessages,
                {
                  role: 'assistant' as const,
                  content: '',
                  timestamp: new Date().toISOString(),
                  metadata: { type: 'research_progress' }
                }
              ]);
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

  // Initialize new session
  const initializeNewSession = useCallback(async () => {
    setStatus('initializing');
    setError(null);

    try {
      const response = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start session');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setStatus('ready');

      window.history.replaceState(window.history.state, '', `/sessions/${data.sessionId}`);

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

      const response = await fetch(`/api/sessions/${sessionId}/message`, {
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
            console.log('[doc_updated] Setting researchDoc:', update.doc);
            setResearchDoc(update.doc);
            setResearchProgress({
              objective: update.doc.objective
            });
          }
          const initCount = update.doc?.questions?.length || 0;
          const searchCount = update.doc?.questions?.reduce((sum, i) => sum + (i.searches?.length || 0), 0) || 0;
          addEvent('doc_updated', 'Document updated', `${initCount} questions, ${searchCount} searches`, 'info');
        }

        if (update.type === 'phase_added') {
          addEvent('phase_added', 'Phase added', (update as any).title, 'log');
        }

        if (update.type === 'phase_completed') {
          addEvent('phase_completed', 'Phase completed', undefined, 'complete');
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
          addEvent('reflection_completed', 'Reflection complete', undefined, 'reflect');

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

        if (update.type === 'research_complete') {
          addEvent('research_complete', 'Research complete', `${update.totalSearches} searches`, 'complete');
        }

        if (update.type === 'analyzing') {
          setStatus('processing');
          setIntakeSearch(null);
          addEvent('analyzing', 'Analyzing message', 'Understanding your request...', 'info');
        }

        // Intake search events
        if (update.type === 'intake_searching') {
          setIntakeSearch({ query: update.query || 'Looking up...', status: 'searching' });
          addEvent('intake_searching', 'Looking up', update.query || '', 'search');
        }

        if (update.type === 'intake_search_complete') {
          setIntakeSearch(null); // Clear the indicator
          addEvent('intake_search_complete', 'Lookup complete', update.answer?.substring(0, 100) || '', 'search');

          // Add search result as a message (in React state only, not saved to DB)
          const searchMessage: Message = {
            role: 'assistant',
            content: `Looked up "${update.query}"`,
            timestamp: new Date().toISOString(),
            metadata: {
              type: 'intake_search',
              query: update.query,
              answer: update.answer
            }
          };
          setMessages(prev => [...prev, searchMessage]);
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

        // ========== BRAIN EVENTS ==========

        // ResearchQuestion search events
        if (update.type === 'question_search_started') {
          setStage('searching');
          const queries = (update as any).queries || [];
          addEvent('search_started', 'Searching...', queries.map((q: any) => q.query || q).join(', ').substring(0, 60), 'search');
        }

        if (update.type === 'question_search_completed') {
          setStage(null);
          const completedQueries = (update as any).queries || [];
          addEvent('search_completed', `Search complete`, `${completedQueries.length} queries`, 'search');

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

        // ResearchQuestion lifecycle events
        if (update.type === 'question_started') {
          const name = (update as any).name || '';
          addEvent('question_started', 'ResearchQuestion started', name.substring(0, 50), 'phase');
        }

        if (update.type === 'question_cycle_started') {
          const cycle = (update as any).cycle || 0;
          const name = (update as any).name || '';
          addEvent('question_cycle', `Cycle ${cycle}`, name.substring(0, 40), 'phase');
        }

        if (update.type === 'question_reflection') {
          const learned = (update as any).learned || '';
          const nextStep = (update as any).nextStep || '';
          addEvent('reflection', `Learned: ${learned.substring(0, 30)}`, nextStep.substring(0, 40), 'reflect');
        }

        if (update.type === 'question_completed') {
          const confidence = (update as any).confidence || '';
          const recommendation = (update as any).recommendation || '';
          addEvent('question_done', `ResearchQuestion complete (${confidence})`, recommendation, 'complete');
        }

        // Brain decision events
        if (update.type === 'brain_initialized') {
          addEvent('brain_init', 'Brain initialized', (update as any).objective?.substring(0, 50), 'info');
        }

        if (update.type === 'brain_generating_questions') {
          addEvent('brain_gen', 'Generating questions', `Creating ${(update as any).count || 3} research angles`, 'plan');
        }

        if (update.type === 'brain_questions_generated') {
          const count = (update as any).count || 0;
          addEvent('brain_ready', `${count} questions ready`, 'Starting research...', 'plan');
        }

        if (update.type === 'brain_strategy') {
          const approach = (update as any).approach || '';
          const strategy = (update as any).strategy || '';
          addEvent('brain_strategy', 'Research strategy', approach.substring(0, 100), 'plan');
        }

        if (update.type === 'brain_evaluating') {
          addEvent('brain_eval', 'Evaluating progress', 'Deciding next steps...', 'reflect');
        }

        if (update.type === 'brain_decision') {
          const decision = (update as any).decision || '';
          const reasoning = (update as any).reasoning || '';
          addEvent('brain_decision', `Decision: ${decision}`, reasoning.substring(0, 60), 'plan');
        }

        if (update.type === 'brain_synthesizing') {
          setStage('synthesizing');
          addEvent('synthesizing', 'Synthesizing answer', 'Combining all findings...', 'complete');
        }

        if (update.type === 'question_spawned') {
          const name = (update as any).name || '';
          addEvent('spawn', 'New question', name.substring(0, 50), 'plan');
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
              // BrainDoc (version 1 or 2)
              if (parsed.version === 1 || parsed.version === 2) {
                console.log('[brain_update] Setting researchDoc from brain:', parsed);
                setResearchDoc(parsed as BrainDoc);
                // Insert a single "anchor" message so ResearchProgress appears inline in the chat flow.
                // This prevents other messages (e.g., reviewer) from visually stacking "above" the research UI.
                setMessages(prev => {
                  const alreadyHasAnchor = prev.some(m => m.metadata?.type === 'research_progress');
                  if (alreadyHasAnchor) return prev;
                  return [
                    ...prev,
                    {
                      role: 'assistant' as const,
                      content: '',
                      timestamp: new Date().toISOString(),
                      metadata: { type: 'research_progress' }
                    }
                  ];
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
      await fetch(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
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
    intakeSearch,
    sendMessage,
    stopResearch,
    initializeSession: initializeNewSession
  };
}
