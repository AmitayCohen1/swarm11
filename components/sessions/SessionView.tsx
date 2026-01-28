'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CreditBalance } from '@/components/CreditBalance';
import { UserButton } from '@clerk/nextjs';
import { Badge } from '@/components/ui/badge';

// New modular components
import ResearchLayout from './ResearchLayout';
import { toast } from 'sonner';
import {
  Send,
  Loader2,
  Moon,
  Sun,
  User,
  Search,
  PenLine,
  Check,
  Globe,
  Brain,
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Shield,
  Telescope,
  Activity,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// --- Sub-components for better organization ---

/**
 * Component for ask_user questions with options + custom input
 */
function AskUserOptions({
  question,
  options,
  reason,
  status,
  onSelect
}: {
  question: string;
  options: { label: string; description?: string }[];
  reason?: string;
  status: string;
  onSelect: (value: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (label: string) => {
    if (status !== 'ready' || selected) return;
    setSelected(label);
    onSelect(label);
  };

  const handleSubmitCustom = () => {
    if (customInput.trim() && status === 'ready' && !selected) {
      setSelected(customInput.trim());
      onSelect(customInput.trim());
      setShowInput(false);
    }
  };

  if (selected) {
    const unselectedOptions = options.filter(opt => opt.label !== selected);
    return (
      <div className="space-y-2 mt-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
            <Telescope className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 space-y-1 pt-1.5">
            <p className="text-slate-400 text-sm font-medium">{question}</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Check className="w-3 h-3" />
                {selected}
              </div>
              {unselectedOptions.map((opt, i) => (
                <span key={i} className="px-3 py-1 text-xs text-slate-600 line-through">
                  {opt.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-2 p-5 rounded-2xl bg-white/2 border border-white/5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
          <Telescope className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 space-y-1 pt-1">
          <p className="text-white text-sm font-semibold">{question}</p>
          {reason && (
            <p className="text-slate-500 text-xs italic">{reason}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pl-11">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt.label)}
            disabled={status !== 'ready'}
            className="group px-4 py-2 text-xs font-semibold rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed border-white/10 bg-white/5 text-slate-300 hover:bg-white hover:text-black hover:border-white active:scale-95"
          >
            {opt.label}
          </button>
        ))}
        {!showInput && (
          <button
            onClick={() => setShowInput(true)}
            disabled={status !== 'ready'}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-dashed border-white/20 bg-transparent text-slate-500 hover:bg-white/5 hover:border-white/40 hover:text-white transition-all flex items-center gap-2"
          >
            <PenLine className="w-3 h-3" />
            Custom
          </button>
        )}
      </div>

      {showInput && (
        <div className="flex gap-2 pl-11 animate-in zoom-in-95 duration-200">
          <Input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmitCustom();
              if (e.key === 'Escape') {
                setShowInput(false);
                setCustomInput('');
              }
            }}
            placeholder="Type response..."
            autoFocus
            disabled={status !== 'ready'}
            className="flex-1 h-10 bg-white/5 border-white/10 rounded-xl focus:border-white/20 px-3 text-sm text-white"
          />
          <Button
            onClick={handleSubmitCustom}
            disabled={!customInput.trim() || status !== 'ready'}
            className="h-10 px-4 bg-white text-black hover:bg-slate-200 rounded-xl font-bold shadow-lg transition-all active:scale-95"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={() => {
              setShowInput(false);
              setCustomInput('');
            }}
            variant="ghost"
            className="h-10 px-3 text-slate-500 hover:text-white hover:bg-white/5 rounded-xl font-medium text-xs"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Component for showing search results
 */
function SearchBatch({ queries }: { queries: any[] }) {
  const validQueries = (queries || []).filter(q => q && (q.query || q.answer));

  if (validQueries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 py-2 animate-in fade-in duration-500 border-l-2 border-white/5 ml-4 pl-6">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Knowledge Discovery Phase</p>
      </div>

      <div className="space-y-3">
        {validQueries.map((q, i) => {
          const queryText = q.query || q.text || 'Searching...';
          return (
            <div key={i} className="group flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {q.status === 'searching' ? (
                  <Loader2 className="w-3 h-3 text-blue-500 animate-spin shrink-0" />
                ) : (
                  <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                )}
                <p className="text-xs font-semibold text-slate-400 group-hover:text-slate-200 transition-colors">
                  {queryText}
                </p>
              </div>

              {q.answer && (
                <div className="ml-5 p-4 rounded-2xl bg-white/2 border border-white/5 hover:bg-white/4 transition-all">
                  <div className="text-[13px] text-slate-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      components={{
                        p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline font-medium" />
                        ),
                      }}
                    >
                      {q.answer}
                    </ReactMarkdown>
                  </div>

                  {q.sources?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
                      {q.sources.slice(0, 3).map((s: any, j: number) => (
                        <a
                          key={j}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-md bg-white/5 text-slate-500 hover:text-white transition-all"
                        >
                          <Globe className="w-2.5 h-2.5" />
                          {getDomain(s.url)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Helper: Strip markdown images from content
 */
function stripMarkdownImages(content: string): string {
  // Remove markdown images: ![alt](url) and ![alt]
  let cleaned = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Remove HTML img tags
  cleaned = cleaned.replace(/<img[^>]*>/gi, '');
  // Remove leftover empty lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Helper: Extract domain from URL
 */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Component for extract results (URL scraping)
 */
function ExtractBatch({ purpose, status, results, failed }: {
  purpose?: string;
  status: string;
  results: { url: string; content: string }[];
  failed: { url: string; error: string }[];
}) {
  return (
    <div className="space-y-4 animate-in fade-in duration-500 py-2 ml-4 pl-6 border-l-2 border-white/5">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Deep Insight Scrape</p>
      </div>

      {status === 'extracting' && (
        <div className="flex items-center gap-3 py-4 px-4 rounded-2xl bg-white/2 border border-white/5 animate-pulse">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          <span className="text-xs font-semibold text-slate-400 tracking-tight">Extracting structured data...</span>
        </div>
      )}

      <div className="space-y-3">
        {status === 'complete' && results.map((result, i) => (
          <div key={i} className="rounded-2xl border border-white/5 bg-white/2 overflow-hidden hover:bg-white/4 transition-all">
            <div className="px-4 py-2 bg-white/2 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-3 h-3 text-emerald-500" />
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-bold text-blue-400 hover:underline truncate max-w-[200px]"
                >
                  {getDomain(result.url)}
                </a>
              </div>
              <Badge variant="outline" className="text-[8px] h-3.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-1">
                Parsed
              </Badge>
            </div>

            <div className="px-4 py-3">
              <div className="text-xs text-slate-400 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar font-mono">
                <pre className="whitespace-pre-wrap font-sans text-[11px]">
                  {stripMarkdownImages(result.content).substring(0, 800)}
                  {result.content.length > 800 && '...'}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      {failed && failed.length > 0 && (
        <div className="px-4 py-2 rounded-xl bg-red-500/5 border border-red-500/10">
          <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest mb-1">Scrape Unsuccessful</p>
          <div className="space-y-0.5">
            {failed.map((f, i) => (
              <p key={i} className="text-[10px] text-red-400/60 truncate font-medium">
                {getDomain(f.url)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Component for research/search results
 */
function ResearchQuery({ msg }: { msg: any }) {
  return (
    <div className="group relative pl-10 py-2 animate-in fade-in duration-700">
      <div className="absolute left-[17px] top-0 bottom-0 w-px bg-white/5 group-last:bg-transparent" />
      <div className="absolute left-[13px] top-5 w-2 h-2 rounded-full border border-blue-500/40 bg-black" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Telescope className="w-3.5 h-3.5 text-blue-400/60" />
          <span className="text-white text-sm font-bold tracking-tight">
            {msg.metadata.query}
          </span>
          {!msg.metadata.answer && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
        </div>

        {msg.metadata.answer && (
          <div className="p-4 rounded-2xl bg-white/2 border border-white/5 hover:bg-white/4 transition-all">
            <div className="text-slate-300 text-[13px] leading-relaxed prose prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ node, ...props }) => <p {...props} className="mb-3 last:mb-0" />,
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />
                  ),
                }}
              >
                {msg.metadata.answer}
              </ReactMarkdown>
            </div>

            {msg.metadata.sources?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-white/5">
                {msg.metadata.sources.slice(0, 3).map((s: any, i: number) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={s.title}
                    className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold rounded-md bg-white/5 text-slate-500 hover:text-white transition-all border border-transparent hover:border-white/10"
                  >
                    <Search className="w-2.5 h-2.5" />
                    {s.title || getDomain(s.url)}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Component for displaying agent reflection (what we learned + what to do next)
 */
function ReasoningContent({ reflection }: { reflection: string }) {
  return (
    <div className="group relative pl-10 py-2 animate-in fade-in duration-700">
      <div className="absolute left-[17px] top-0 bottom-0 w-px bg-white/5 group-last:bg-transparent" />
      <div className="absolute left-[13px] top-5 w-2 h-2 rounded-full border border-purple-500/40 bg-black" />

      <div className="p-4 rounded-2xl bg-purple-500/2 border border-purple-500/10">
        <div className="flex items-start gap-3">
          <Brain className="w-4 h-4 text-purple-400/60 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-[10px] font-bold text-purple-400/60 uppercase tracking-widest mb-1">Neural Reflection</p>
            <div className="text-slate-400 text-xs leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{reflection}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Component for displaying reviewer verdict and notes
 */
function ReviewResult({ verdict, critique, missing }: {
  verdict: string;
  critique: string;
  missing: string[];
}) {
  const isPassing = verdict === 'pass';

  return (
    <div className="animate-in fade-in duration-700 py-4">
      <div className={cn(
        "p-6 rounded-3xl border backdrop-blur-sm transition-all",
        isPassing
          ? "bg-emerald-500/2 border-emerald-500/10"
          : "bg-amber-500/2 border-amber-500/10"
      )}>
        <div className="flex items-start gap-5">
          <div className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-lg",
            isPassing
              ? "bg-emerald-500 text-white"
              : "bg-amber-500 text-white"
          )}>
            <Shield className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Quality Protocol
              </p>
              <div className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                isPassing
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/20 text-amber-400"
              )}>
                {isPassing ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {isPassing ? 'VERIFIED' : 'REVISION'}
              </div>
            </div>
            
            <p className="text-slate-200 text-[14px] leading-relaxed font-medium">
              {critique}
            </p>
            
            {missing && missing.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2">Missing Criteria</p>
                <div className="grid gap-1.5">
                  {missing.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-slate-400">
                      <div className="w-1 h-1 rounded-full bg-amber-500/40" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

interface SessionViewProps {
  sessionId?: string;
}

export default function SessionView({ sessionId: existingSessionId }: SessionViewProps) {
  const router = useRouter();
  const {
    sessionId,
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    researchDoc,
    stage,
    eventLog,
    intakeSearch,
    sendMessage,
    stopResearch,
    initializeSession
  } = useSession({ existingSessionId });

  const [inputMessage, setInputMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [logTab, setLogTab] = useState<'events' | 'memory'>('events');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // New state for three-column layout
  const [showInterruptedBanner, setShowInterruptedBanner] = useState(false);
  const lastEventIdRef = useRef<string | null>(null);

  // Detect interrupted research on load
  useEffect(() => {
    if (
      researchDoc &&
      researchDoc.status === 'running' &&
      Object.keys(researchDoc.nodes).length > 0 &&
      !isResearching &&
      status === 'ready'
    ) {
      setShowInterruptedBanner(true);
    }
  }, [researchDoc, isResearching, status]);

  // Handle continue research
  const handleContinueResearch = useCallback(async () => {
    setShowInterruptedBanner(false);
    if (researchDoc?.objective) {
      await sendMessage(`Continue researching: ${researchDoc.objective}`);
    }
  }, [researchDoc?.objective, sendMessage]);

  // Handle dismiss
  const handleDismissInterrupted = useCallback(() => {
    setShowInterruptedBanner(false);
  }, []);

  // Watch eventLog for decision-worthy events and show toasts
  useEffect(() => {
    if (eventLog.length === 0) return;
    const lastEvent = eventLog[eventLog.length - 1];

    // Avoid duplicate toasts for the same event
    if (lastEvent.id === lastEventIdRef.current) return;
    lastEventIdRef.current = lastEvent.id;

    // Show toast for events (brain_decision handled by DecisionToast in ResearchLayout)
    if (lastEvent.type === 'spawn' || lastEvent.type === 'question_spawned') {
      toast(lastEvent.label, {
        description: lastEvent.detail,
        icon: <Zap className="w-4 h-4 text-blue-400" />,
        duration: 3000,
      });
    } else if (lastEvent.type === 'question_done' || lastEvent.type === 'question_completed') {
      toast.success(lastEvent.label, {
        description: lastEvent.detail,
        duration: 3000,
      });
    } else if (lastEvent.type === 'brain_synthesizing' || lastEvent.type === 'synthesizing') {
      toast(lastEvent.label, {
        description: lastEvent.detail,
        icon: <CheckCircle className="w-4 h-4 text-emerald-400" />,
        duration: 4000,
      });
    }
  }, [eventLog]);

  // When research tree is visible, avoid duplicating in chat timeline
  const hasResearchNodes = Boolean(
    researchDoc &&
    typeof researchDoc === 'object' &&
    'nodes' in researchDoc &&
    Object.keys(researchDoc.nodes).length > 0
  );

  // Check if there's a pending multi-select (last assistant message is multi_choice_select)
  const hasPendingMultiSelect = (() => {
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    return lastAssistantMsg?.metadata?.type === 'multi_choice_select' ||
           lastAssistantMsg?.metadata?.type === 'ask_user';
  })();

  // Only auto-scroll on new user messages or when research completes, not during research updates
  const lastUserMsgCount = messages.filter(m => m.role === 'user').length;
  useEffect(() => {
    // Scroll when user sends a message
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastUserMsgCount]);

  useEffect(() => {
    // Scroll when research finishes
    if (!isResearching && status === 'ready') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isResearching, status]);

  // Auto-scroll logs panel
  useEffect(() => {
    if (showLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [eventLog, showLogs]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || status !== 'ready') return;

    const message = inputMessage.trim();
    setInputMessage('');
    await sendMessage(message);
  };

  const getStatusBadge = () => {
    // Check if research is complete
    const isResearchComplete = researchDoc &&
      typeof researchDoc === 'object' &&
      'status' in researchDoc &&
      researchDoc.status === 'complete';

    const variants: Record<string, { bg: string; text: string; label: string; pulse?: boolean; icon?: 'check' }> = {
      initializing: { bg: 'bg-slate-100 dark:bg-white/10', text: 'text-slate-500', label: 'Booting' },
      ready: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Online' },
      processing: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Researching', pulse: true },
      researching: { bg: 'bg-indigo-100 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', label: 'Researching', pulse: true },
      error: { bg: 'bg-red-100 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'Offline' },
      complete: { bg: 'bg-green-100 dark:bg-green-500/20', text: 'text-green-600 dark:text-green-400', label: 'Complete', icon: 'check' }
    };

    // Use 'complete' variant if research is complete, otherwise use current status
    const effectiveStatus = isResearchComplete ? 'complete' : status;
    const config = variants[effectiveStatus as keyof typeof variants] || variants.ready;

    return (
      <div className={cn(
        "flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider shadow-sm transition-all duration-500",
        config.bg,
        config.text
      )}>
        {config.pulse && (
          <span className="relative flex h-2 w-2">
            <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", config.text.replace('text-', 'bg-'))}></span>
            <span className={cn("relative inline-flex rounded-full h-2 w-2", config.text.replace('text-', 'bg-'))}></span>
          </span>
        )}
        {config.icon === 'check' && (
          <CheckCircle className="w-3 h-3" />
        )}
        {config.label}
      </div>
    );
  };

  // Full-screen research mode: when researching or have research data with nodes
  const isInResearchMode = isResearching || (researchDoc && 'nodes' in researchDoc && Object.keys(researchDoc.nodes).length > 0);

  // Helper to get icon for log entry
  const getLogIcon = (icon: string) => {
    switch (icon) {
      case 'plan': return <Brain className="w-3 h-3" />;
      case 'search': return <Search className="w-3 h-3" />;
      case 'reflect': return <PenLine className="w-3 h-3" />;
      case 'phase': return <Activity className="w-3 h-3" />;
      case 'complete': return <CheckCircle className="w-3 h-3" />;
      case 'error': return <AlertCircle className="w-3 h-3" />;
      default: return <Zap className="w-3 h-3" />;
    }
  };

  const getLogColor = (icon: string) => {
    switch (icon) {
      case 'plan': return 'text-purple-400 bg-purple-500/10';
      case 'search': return 'text-blue-400 bg-blue-500/10';
      case 'reflect': return 'text-amber-400 bg-amber-500/10';
      case 'phase': return 'text-cyan-400 bg-cyan-500/10';
      case 'complete': return 'text-emerald-400 bg-emerald-500/10';
      case 'error': return 'text-red-400 bg-red-500/10';
      default: return 'text-slate-400 bg-white/5';
    }
  };

  return (
    <div className={cn("h-screen w-full flex overflow-hidden font-sans selection:bg-blue-100 dark:selection:bg-blue-500/30", isDarkMode ? 'dark' : '')}>
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#0a0a0a]">

        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-slate-200/60 dark:border-white/5 bg-white/80 dark:bg-black/40 backdrop-blur-md z-30">
          <div className="flex items-center gap-3">
            {/* Back to sessions button */}
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
              onClick={() => router.push('/sessions')}
              title="Back to sessions"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </Button>

            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div 
                className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center shadow-lg cursor-pointer hover:scale-105 transition-all"
                onClick={() => router.push('/')}
              >
                <Brain className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg tracking-tight text-white">
                Research
              </span>
            </div>

            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-3">
            <CreditBalance />

            <div className="w-px h-4 bg-white/10 mx-1" />

            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-8 h-8 rounded-lg transition-all border",
                showLogs
                  ? "text-blue-400 bg-blue-500/20 border-blue-500/50"
                  : "text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
              )}
              onClick={() => setShowLogs(!showLogs)}
              title={showLogs ? "Hide logs" : "Show logs"}
            >
              <Activity className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? "Light mode" : "Dark mode"}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            {isResearching && (
              <Button
                onClick={stopResearch}
                variant="destructive"
                size="sm"
                className="h-8 px-3 bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white text-[10px] font-black tracking-widest rounded-lg transition-all active:scale-95"
              >
                STOP
              </Button>
            )}

            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        {/* RESEARCH MODE */}
        {isInResearchMode ? (
          <ResearchLayout
            messages={messages}
            status={status}
            isResearching={isResearching}
            researchDoc={researchDoc}
            intakeSearch={intakeSearch}
            error={error}
            onSendMessage={sendMessage}
            showInterruptedBanner={showInterruptedBanner}
            onContinueResearch={handleContinueResearch}
            onDismissInterrupted={handleDismissInterrupted}
          />
        ) : (
          /* CHAT MODE: Normal chat interface */
          <>
            <main className="flex-1 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
              <div className="py-10 px-6 space-y-8 max-w-4xl mx-auto">
                  {messages.filter(m => m.metadata?.kind !== 'final').map((msg, idx) => {
                    if (msg.metadata?.type === 'research_iteration') return null;

                    const isUser = msg.role === 'user';

                    if (isUser) {
                      return (
                        <div key={idx} className="flex flex-col items-end gap-2 animate-in fade-in slide-in-from-right-4 duration-500">
                          <div className="flex items-start gap-3 max-w-[85%]">
                            <div className="px-5 py-3 rounded-[2rem] rounded-tr-lg bg-white text-black shadow-xl">
                              <p className="text-base md:text-lg leading-relaxed font-semibold">{msg.content}</p>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                              <User className="w-4 h-4 text-slate-400" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Metadata-driven messages (process steps)
                    if (msg.metadata?.type === 'search_batch') {
                      if (hasResearchNodes) return null;
                      return <SearchBatch key={idx} queries={msg.metadata.queries || []} />;
                    }
                    if (msg.metadata?.type === 'extract_batch') {
                      return (
                        <ExtractBatch
                          key={idx}
                          purpose={msg.metadata.purpose}
                          status={msg.metadata.status}
                          results={msg.metadata.results || []}
                          failed={msg.metadata.failed || []}
                        />
                      );
                    }
                    if (msg.metadata?.type === 'research_query') {
                      if (hasResearchNodes) return null;
                      return <ResearchQuery key={idx} msg={msg} />;
                    }
                    if (msg.metadata?.type === 'reasoning') {
                      return <ReasoningContent key={idx} reflection={msg.metadata.reflection || ''} />;
                    }
                    if (msg.metadata?.type === 'research_progress') {
                      return null; // Don't show in chat mode - we'll switch to research mode
                    }
                    if (msg.metadata?.type === 'review_result') {
                      return (
                        <ReviewResult
                          key={idx}
                          verdict={msg.metadata.verdict || 'unknown'}
                          critique={msg.metadata.critique || ''}
                          missing={msg.metadata.missing || []}
                        />
                      );
                    }
                    if (msg.metadata?.type === 'intake_search') {
                      return (
                        <div key={idx} className="flex items-start gap-5 animate-in fade-in slide-in-from-left-2 duration-500">
                          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                            <Search className="w-5 h-5 text-amber-400" />
                          </div>
                          <div className="flex-1 pt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">Looked up</p>
                              <Check className="w-3 h-3 text-emerald-400" />
                            </div>
                            <p className="text-sm text-slate-300 font-medium">{msg.metadata.query}</p>
                            {msg.metadata.answer && (
                              <div className="p-4 rounded-2xl bg-white/2 border border-white/5 mt-2">
                                <div className="text-[13px] text-slate-400 leading-relaxed prose prose-invert prose-sm max-w-none">
                                  <ReactMarkdown
                                    components={{
                                      p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                                      a: ({ node, ...props }) => (
                                        <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline font-medium" />
                                      ),
                                    }}
                                  >
                                    {msg.metadata.answer}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (msg.metadata?.type === 'ask_user' || msg.metadata?.type === 'multi_choice_select') {
                      return (
                        <div key={idx} className="animate-in fade-in duration-500">
                          <AskUserOptions
                            question={msg.metadata.question || msg.content}
                            options={msg.metadata.options || []}
                            reason={msg.metadata.reason}
                            status={status}
                            onSelect={(value) => sendMessage(value)}
                          />
                        </div>
                      );
                    }
                    // Default Agent Message
                    return (
                      <div key={idx} className="flex items-start gap-5 animate-in fade-in slide-in-from-left-4 duration-700">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
                          <Zap className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 pt-2 space-y-3">
                          {msg.metadata?.reason && (
                            <p className="text-sm text-slate-500 italic font-medium">{msg.metadata.reason}</p>
                          )}
                          <div className="prose prose-invert max-w-none text-slate-200">
                            <ReactMarkdown
                              components={{
                                p: ({ node, ...props }) => <p {...props} className="text-base md:text-lg leading-relaxed mb-4 last:mb-0 font-medium" />,
                                ul: ({ node, ...props }) => <ul {...props} className="mb-4 space-y-3 list-none" />,
                                ol: ({ node, ...props }) => <ol {...props} className="mb-4 space-y-3 list-decimal list-inside" />,
                                li: ({ node, ...props }) => (
                                  <li className="flex items-start gap-3 text-base md:text-lg font-medium">
                                    <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                    <span {...props} />
                                  </li>
                                ),
                                h1: ({ node, ...props }) => <h1 {...props} className="text-3xl font-black mb-6 tracking-tighter text-white" />,
                                h2: ({ node, ...props }) => <h2 {...props} className="text-2xl font-bold mb-4 tracking-tight text-white" />,
                                h3: ({ node, ...props }) => <h3 {...props} className="text-xl font-bold mb-3 tracking-tight text-white" />,
                                strong: ({ node, ...props }) => <strong {...props} className="font-black text-white" />,
                                code: (rawProps: any) => {
                                  const { inline, ...props } = rawProps || {};
                                  return inline
                                    ? <code {...props} className="px-1.5 py-0.5 bg-white/10 rounded-md text-sm font-mono text-blue-300" />
                                    : <pre className="p-5 bg-white/2 rounded-2xl text-sm overflow-x-auto my-8 border border-white/5 shadow-inner"><code {...props} className="font-mono text-slate-300" /></pre>;
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Final Answer - Always below research progress */}
                  {messages.filter(m => m.metadata?.kind === 'final').map((msg, idx) => (
                    <div key={`final-${idx}`} className="flex items-start gap-5 animate-in fade-in slide-in-from-left-4 duration-1000 mt-12 pt-12 border-t border-white/5">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
                        <CheckCircle className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 pt-2 space-y-4">
                        <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.3em]">Final Insight Matrix</p>
                        <div className="prose prose-invert max-w-none text-white">
                          <ReactMarkdown
                            components={{
                              p: ({ node, ...props }) => <p {...props} className="text-lg md:text-xl leading-relaxed mb-6 last:mb-0 font-semibold" />,
                              ul: ({ node, ...props }) => <ul {...props} className="mb-6 space-y-4 list-none" />,
                              ol: ({ node, ...props }) => <ol {...props} className="mb-6 space-y-4 list-decimal list-inside" />,
                              li: ({ node, ...props }) => (
                                <li className="flex items-start gap-3 text-lg md:text-xl font-semibold">
                                  <span className="mt-3 w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                  <span {...props} />
                                </li>
                              ),
                              h1: ({ node, ...props }) => <h1 {...props} className="text-4xl font-black mb-8 tracking-tighter" />,
                              h2: ({ node, ...props }) => <h2 {...props} className="text-3xl font-bold mb-6 tracking-tight" />,
                              h3: ({ node, ...props }) => <h3 {...props} className="text-2xl font-bold mb-4 tracking-tight" />,
                              strong: ({ node, ...props }) => <strong {...props} className="font-black text-emerald-400" />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Intake Search Indicator */}
                  {intakeSearch && (
                    <div className="flex items-start gap-5 animate-in fade-in slide-in-from-left-2 duration-300">
                      <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                        <Search className={`w-5 h-5 text-amber-400 ${intakeSearch.status === 'searching' ? 'animate-pulse' : ''}`} />
                      </div>
                      <div className="flex-1 pt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                            {intakeSearch.status === 'searching' ? 'Looking up' : 'Looked up'}
                          </p>
                          {intakeSearch.status === 'searching' && (
                            <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
                          )}
                          {intakeSearch.status === 'complete' && (
                            <Check className="w-3 h-3 text-emerald-400" />
                          )}
                        </div>
                        <p className="text-sm text-slate-300 font-medium">{intakeSearch.query}</p>
                        {intakeSearch.status === 'complete' && intakeSearch.answer && (
                          <div className="mt-2 p-3 rounded-lg bg-white/[0.02] border border-white/5 max-h-48 overflow-y-auto">
                            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                              {intakeSearch.answer}
                                                      </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}


                  {/* Error Display */}
                  {error && (
                    <div className="mx-auto max-w-2xl p-6 rounded-3xl bg-red-500/5 border border-red-500/10 flex items-start gap-4 animate-in shake-1">
                      <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-black text-red-500 uppercase tracking-widest">Neural Fault</p>
                        <p className="text-base text-red-400/80 leading-relaxed font-medium">{error}</p>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} className="h-10" />
                </div>
            </main>

            {/* Input Area */}
            <footer className="p-6 bg-[#0a0a0a] border-t border-white/5 z-40">
              <form onSubmit={handleSend} className="relative group max-w-4xl mx-auto">
                <div className="relative flex items-center gap-3 p-2 rounded-3xl bg-white/2 border border-white/5 focus-within:border-white/10 focus-within:bg-white/4 transition-all duration-500 shadow-2xl">
                  <Input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder={hasPendingMultiSelect ? "Protocol pending selection..." : status === 'ready' ? "Initiate research query..." : "Standby..."}
                    disabled={status !== 'ready' || hasPendingMultiSelect}
                    className="flex-1 bg-transparent border-none h-12 px-4 text-base focus-visible:ring-0 placeholder:text-slate-600 text-white font-medium"
                  />
                  <Button
                    type="submit"
                    disabled={!inputMessage.trim() || status !== 'ready' || hasPendingMultiSelect}
                    className={cn(
                      "h-12 w-12 rounded-[1.25rem] transition-all duration-500 shadow-xl",
                      inputMessage.trim() && status === 'ready'
                        ? 'bg-white text-black hover:bg-slate-200 hover:scale-105 active:scale-95'
                        : 'bg-white/5 text-slate-600 opacity-20'
                    )}
                    size="icon"
                  >
                    <Send className="w-5 h-5" />
                  </Button>
                </div>
              </form>
            </footer>
          </>
        )}
      </div>

      {/* Logs Panel */}
      <div className={cn(
        "h-full bg-[#0a0a0a] border-l border-white/5 flex flex-col transition-all duration-300 overflow-hidden",
        showLogs ? "w-96" : "w-0"
      )}>
        {showLogs && (
          <>
            <div className="h-14 flex items-center justify-between px-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLogTab('events')}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold transition-colors",
                    logTab === 'events' ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  <Activity className="w-3 h-3" />
                  Events
                  <span className="text-[9px] bg-white/5 px-1 rounded">{eventLog.length}</span>
                </button>
                <button
                  onClick={() => setLogTab('memory')}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold transition-colors",
                    logTab === 'memory' ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  <Brain className="w-3 h-3" />
                  Memory
                </button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-slate-500 hover:text-white hover:bg-white/5 rounded"
                onClick={() => setShowLogs(false)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
              {logTab === 'events' ? (
                eventLog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-slate-600">
                    <Activity className="w-6 h-6 mb-2 opacity-50" />
                    <p className="text-xs font-medium">No events yet</p>
                  </div>
                ) : (
                  eventLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="group flex items-start gap-2 p-2 rounded-lg hover:bg-white/2 transition-colors"
                    >
                      <div className={cn(
                        "w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5",
                        getLogColor(entry.icon)
                      )}>
                        {getLogIcon(entry.icon)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-300 truncate">
                          {entry.label}
                        </p>
                        {entry.detail && (
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {entry.detail}
                          </p>
                        )}
                        <p className="text-[9px] text-slate-600 mt-1 font-mono">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))
                )
              ) : (
                <div className="space-y-3">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Brain State</div>
                  <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap break-all bg-black/30 p-3 rounded-lg border border-white/5 max-h-[calc(100vh-200px)] overflow-auto">
                    {researchDoc ? JSON.stringify(researchDoc, null, 2) : 'No brain state'}
                  </pre>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
