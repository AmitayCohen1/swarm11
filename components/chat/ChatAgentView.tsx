'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import SessionsSidebar from './SessionsSidebar';
import ResearchProgress from './ResearchProgress';
import {
  Send,
  StopCircle,
  Loader2,
  Sparkles,
  Moon,
  Sun,
  User,
  Search,
  PenLine,
  Check,
  Globe,
  Brain,
  MessageSquare,
  AlertCircle,
  PanelLeft,
  FileText,
  CheckCircle,
  XCircle,
  Shield
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
    return (
      <div className="space-y-3 mt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-start gap-3 opacity-60">
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="space-y-1 pt-1">
            <p className="text-slate-600 dark:text-slate-400 text-base font-medium">{question}</p>
            {reason && (
              <p className="text-slate-500 dark:text-slate-500 text-sm italic">{reason}</p>
            )}
          </div>
        </div>
        <div className="pl-11">
          <div className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-500/20 shadow-sm">
            <Check className="w-4 h-4" />
            {selected}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-2 p-4 rounded-2xl bg-slate-50/50 dark:bg-white/2 border border-slate-200/60 dark:border-white/5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="space-y-1 pt-1">
          <p className="text-slate-800 dark:text-slate-100 text-base font-medium">{question}</p>
          {reason && (
            <p className="text-slate-500 dark:text-slate-400 text-sm italic">{reason}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pl-11">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt.label)}
            disabled={status !== 'ready'}
            className="group px-4 py-2 text-sm font-medium rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-200 dark:hover:border-blue-500/30 hover:text-blue-700 dark:hover:text-blue-300"
          >
            {opt.label}
          </button>
        ))}
        {!showInput && (
          <button
            onClick={() => setShowInput(true)}
            disabled={status !== 'ready'}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-dashed border-slate-300 dark:border-white/20 bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-400 dark:hover:border-white/30 hover:text-slate-700 dark:hover:text-slate-200 transition-all flex items-center gap-1.5"
          >
            <PenLine className="w-3.5 h-3.5" />
            Custom...
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
            placeholder="Type your answer..."
            autoFocus
            disabled={status !== 'ready'}
            className="flex-1 h-10 text-sm bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 rounded-xl"
          />
          <Button
            onClick={handleSubmitCustom}
            disabled={!customInput.trim() || status !== 'ready'}
            size="sm"
            className="h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
          <Button
            onClick={() => {
              setShowInput(false);
              setCustomInput('');
            }}
            variant="ghost"
            size="sm"
            className="h-10 px-3 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl"
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
    <div className="space-y-3 animate-in fade-in duration-300">
      {/* Questions being asked */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <Search className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 pt-1">
          <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">
            Researching
          </p>
          <div className="space-y-2">
            {validQueries.map((q, i) => {
              const queryText = q.query || q.text || 'Searching...';
              return (
              <div
                key={i}
                className={cn(
                  "p-3 rounded-xl border transition-all",
                  q.status === 'searching'
                    ? "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20"
                    : "bg-white dark:bg-white/3 border-slate-200 dark:border-white/10"
                )}
              >
                {/* The question */}
                <div className="flex items-start gap-2">
                  {q.status === 'searching' ? (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {queryText}
                    </p>
                    {q.purpose && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {q.purpose}
                      </p>
                    )}
                  </div>
                </div>

                {/* Answer (when available) */}
                {q.answer && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                    <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      <ReactMarkdown
                        components={{
                          p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                          a: ({ node, ...props }) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                          ),
                        }}
                      >
                        {q.answer}
                      </ReactMarkdown>
                    </div>

                    {/* Sources */}
                    {q.sources?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {q.sources.slice(0, 4).map((s: any, j: number) => {
                          let domain = '';
                          try {
                            domain = s.url ? new URL(s.url).hostname.replace('www.', '') : '';
                          } catch {
                            domain = s.url || '';
                          }
                          return (
                            <a
                              key={j}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                            >
                              <Globe className="w-2.5 h-2.5" />
                              {domain}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
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
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Purpose header */}
      {purpose && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <FileText className="w-4 h-4" />
          <span className="font-medium">Extracting:</span>
          <span className="italic">{purpose}</span>
        </div>
      )}

      {/* Loading state */}
      {status === 'extracting' && (
        <div className="flex items-center gap-3 py-4 px-4 rounded-2xl bg-slate-50 dark:bg-white/3 border border-slate-200/60 dark:border-white/6">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <span className="text-slate-600 dark:text-slate-400">Extracting page content...</span>
        </div>
      )}

      {/* Results */}
      {status === 'complete' && results.map((result, i) => (
        <div key={i} className="rounded-2xl border border-slate-200/60 dark:border-white/6 bg-white/50 dark:bg-white/2 overflow-hidden">
          {/* URL header */}
          <div className="px-4 py-3 bg-slate-50/80 dark:bg-white/3 border-b border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
                <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate"
              >
                {getDomain(result.url)}
              </a>
            </div>
          </div>

          {/* Content - stripped of images */}
          <div className="px-4 py-3">
            <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-48 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans">
                {stripMarkdownImages(result.content).substring(0, 1500)}
                {result.content.length > 1500 && '...'}
              </pre>
            </div>
          </div>
        </div>
      ))}

      {/* Failed extractions */}
      {failed && failed.length > 0 && (
        <div className="px-4 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Failed to extract:</p>
          {failed.map((f, i) => (
            <p key={i} className="text-xs text-red-500 dark:text-red-400 truncate">
              {getDomain(f.url)}: {f.error}
            </p>
          ))}
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
    <div className="group relative pl-11 py-2 animate-in fade-in duration-500">
      <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-200 dark:bg-white/10 group-last:bg-transparent" />
      <div className="absolute left-[9px] top-3 w-2.5 h-2.5 rounded-full border-2 border-slate-300 dark:border-white/20 bg-white dark:bg-[#0a0a0a]" />
      
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <span className="text-slate-500 dark:text-slate-400 text-base font-medium tracking-tight">
            {msg.metadata.query}
          </span>
          {!msg.metadata.answer && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
        </div>
        
        {msg.metadata.answer && (
          <div className="p-4 rounded-2xl bg-white dark:bg-white/3 border border-slate-200/60 dark:border-white/6 shadow-sm">
            <div className="text-slate-800 dark:text-slate-200 text-base leading-relaxed prose dark:prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 font-medium hover:underline" />
                  ),
                }}
              >
                {msg.metadata.answer}
              </ReactMarkdown>
            </div>
            
            {msg.metadata.sources?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                {msg.metadata.sources.slice(0, 4).map((s: any, i: number) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={s.title}
                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-md bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors max-w-[150px] truncate"
                  >
                    <Search className="w-2.5 h-2.5" />
                    {s.title}
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
    <div className="group relative pl-11 py-2 animate-in fade-in duration-500">
      <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-200 dark:bg-white/10 group-last:bg-transparent" />
      <div className="absolute left-[9px] top-3 w-2.5 h-2.5 rounded-full border-2 border-purple-300 dark:border-purple-500/40 bg-white dark:bg-[#0a0a0a]" />

      <div className="p-4 rounded-2xl bg-linear-to-br from-purple-50/50 to-indigo-50/50 dark:from-purple-500/5 dark:to-indigo-500/5 border border-purple-100/50 dark:border-purple-500/10 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-5 h-5 rounded-md bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Brain className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-2">Reflection</p>
            <div className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-purple-700 dark:prose-strong:text-purple-300 max-w-none">
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
    <div className="animate-in fade-in duration-500">
      <div className={cn(
        "p-4 rounded-2xl border shadow-sm",
        isPassing
          ? "bg-linear-to-br from-emerald-50/50 to-green-50/50 dark:from-emerald-500/5 dark:to-green-500/5 border-emerald-100/50 dark:border-emerald-500/20"
          : "bg-linear-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-500/5 dark:to-orange-500/5 border-amber-100/50 dark:border-amber-500/20"
      )}>
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
            isPassing
              ? "bg-emerald-100 dark:bg-emerald-500/20"
              : "bg-amber-100 dark:bg-amber-500/20"
          )}>
            <Shield className={cn(
              "w-4 h-4",
              isPassing ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            )} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <p className={cn(
                "text-xs font-bold uppercase tracking-wider",
                isPassing ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              )}>
                Reviewer
              </p>
              <div className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                isPassing
                  ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
              )}>
                {isPassing ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {isPassing ? 'PASS' : 'FAIL'}
              </div>
            </div>
            <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed">
              {critique}
            </p>
            {missing && missing.length > 0 && (
              <div className="mt-3 pt-3 border-t border-amber-200/50 dark:border-amber-500/20">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">Missing:</p>
                <ul className="space-y-1">
                  {missing.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                      <span className="text-amber-400 mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

interface ChatAgentViewProps {
  sessionId?: string;
}

export default function ChatAgentView({ sessionId: existingSessionId }: ChatAgentViewProps) {
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
    sendMessage,
    stopResearch,
    initializeSession
  } = useChatAgent({ existingSessionId });

  const [inputMessage, setInputMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // When CortexDoc tabs are visible, they already show searches/questions; avoid duplicating them in the chat timeline.
  const hasCortexTabs = Boolean(
    researchDoc &&
    typeof researchDoc === 'object' &&
    'questions' in (researchDoc as any) &&
    Array.isArray((researchDoc as any).questions) &&
    (researchDoc as any).questions.length > 0
  );

  // Check if there's a pending multi-select (last assistant message is multi_choice_select)
  const hasPendingMultiSelect = (() => {
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    return lastAssistantMsg?.metadata?.type === 'multi_choice_select' ||
           lastAssistantMsg?.metadata?.type === 'ask_user';
  })();

  const handleNewSession = () => {
    // Navigate to /chat to start fresh
    router.push('/chat');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isResearching]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || status !== 'ready') return;

    const message = inputMessage.trim();
    setInputMessage('');
    await sendMessage(message);
  };

  const getStatusBadge = () => {
    const variants: Record<string, { bg: string; text: string; label: string; pulse?: boolean }> = {
      initializing: { bg: 'bg-slate-100 dark:bg-white/10', text: 'text-slate-500', label: 'Booting' },
      ready: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Online' },
      processing: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Thinking', pulse: true },
      researching: { bg: 'bg-indigo-100 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', label: 'Researching', pulse: true },
      error: { bg: 'bg-red-100 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'Offline' }
    };

    const config = variants[status as keyof typeof variants] || variants.ready;

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
        {config.label}
      </div>
    );
  };

  // Show research progress inline when researching
  const showResearchProgress = isResearching || (researchDoc && 'questions' in researchDoc && (researchDoc as any).questions?.length > 0);

  return (
    <div className={cn("h-screen w-full flex overflow-hidden font-sans selection:bg-blue-100 dark:selection:bg-blue-500/30", isDarkMode ? 'dark' : '')}>
      {/* Sessions Sidebar */}
      <SessionsSidebar
        currentSessionId={sessionId || undefined}
        onNewSession={handleNewSession}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Chat Panel - Full width, research progress inline */}
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0a0a0a] border-r border-slate-200/60 dark:border-white/5">

        {/* Header */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-slate-200/60 dark:border-white/5 bg-white/80 dark:bg-black/40 backdrop-blur-md z-30">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="w-9 h-9 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
                onClick={() => setSidebarCollapsed(false)}
                title="Show sidebar"
              >
                <PanelLeft className="w-4.5 h-4.5" />
              </Button>
            )}
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? "Light mode" : "Dark mode"}
            >
              {isDarkMode ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            </Button>

            {isResearching && (
              <Button
                onClick={stopResearch}
                variant="destructive"
                size="sm"
                className="h-9 px-4 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all hover:scale-105 active:scale-95"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                STOP
              </Button>
            )}
          </div>
        </header>

        {/* Chat Content */}
        <main className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full scroll-smooth">
            <div className="py-6 px-4 space-y-6 max-w-4xl mx-auto">
              {messages.filter(m => m.metadata?.kind !== 'final').map((msg, idx) => {
                if (msg.metadata?.type === 'research_iteration') return null;

                const isUser = msg.role === 'user';

                if (isUser) {
                  return (
                    <div key={idx} className="flex flex-col items-end gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex items-start gap-3 max-w-[85%]">
                        <div className="px-5 py-3 rounded-2xl bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-md">
                          <p className="text-base md:text-lg leading-relaxed font-medium">{msg.content}</p>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 border border-slate-200 dark:border-white/10">
                          <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        </div>
                      </div>
                    </div>
                  );
                }

                // Metadata-driven messages (process steps)
                if (msg.metadata?.type === 'search_batch') {
                  if (hasCortexTabs) return null;
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
                  if (hasCortexTabs) return null;
                  return <ResearchQuery key={idx} msg={msg} />;
                }
                                if (msg.metadata?.type === 'reasoning') {
                  return <ReasoningContent key={idx} reflection={msg.metadata.reflection || ''} />;
                }
                if (msg.metadata?.type === 'research_progress') {
                  return (
                    <div key={idx} className="animate-in fade-in duration-500">
                      {researchDoc && <ResearchProgress doc={researchDoc} />}
                    </div>
                  );
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
                if (msg.metadata?.type === 'ask_user' || msg.metadata?.type === 'multi_choice_select') {
                  return (
                    <div key={idx} className="animate-in fade-in duration-300">
                      <AskUserOptions
                        question={msg.metadata.question}
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
                  <div key={idx} className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4 duration-500">
                    <div className="w-9 h-9 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 pt-1.5 space-y-2">
                      {msg.metadata?.reason && (
                        <p className="text-base text-slate-500 dark:text-slate-400 italic">{msg.metadata.reason}</p>
                      )}
                      <div className="prose prose-slate dark:prose-invert max-w-none text-slate-800 dark:text-slate-100">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p {...props} className="text-base md:text-lg leading-relaxed mb-4 last:mb-0" />,
                            ul: ({ node, ...props }) => <ul {...props} className="mb-4 space-y-2 list-none" />,
                            ol: ({ node, ...props }) => <ol {...props} className="mb-4 space-y-2 list-decimal list-inside" />,
                            li: ({ node, ...props }) => (
                              <li className="flex items-start gap-2 text-base md:text-lg">
                                <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                                <span {...props} />
                              </li>
                            ),
                            h1: ({ node, ...props }) => <h1 {...props} className="text-2xl font-black mb-4 tracking-tight" />,
                            h2: ({ node, ...props }) => <h2 {...props} className="text-xl font-bold mb-3 tracking-tight" />,
                            h3: ({ node, ...props }) => <h3 {...props} className="text-lg font-bold mb-2 tracking-tight" />,
                            strong: ({ node, ...props }) => <strong {...props} className="font-bold text-slate-900 dark:text-white" />,
                            code: (rawProps: any) => {
                              const { inline, ...props } = rawProps || {};
                              return inline
                                ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded-md text-sm font-mono text-blue-600 dark:text-blue-400" />
                                : <pre className="p-4 bg-slate-900 dark:bg-black/40 rounded-2xl text-sm overflow-x-auto my-6 border border-white/5"><code {...props} className="font-mono text-slate-300" /></pre>;
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

              {/* Research Progress - Inline */}
              {/* Research progress is rendered inline via a special 'research_progress' message */}

              {/* Final Answer - Always below research progress */}
              {messages.filter(m => m.metadata?.kind === 'final').map((msg, idx) => (
                <div key={`final-${idx}`} className="flex items-start gap-4 animate-in fade-in slide-in-from-left-4 duration-500 mt-6 pt-6 border-t border-slate-200 dark:border-white/10">
                  <div className="w-9 h-9 rounded-2xl bg-green-600 flex items-center justify-center shrink-0 shadow-lg shadow-green-500/20">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 pt-1.5 space-y-2">
                    <div className="prose prose-slate dark:prose-invert max-w-none text-slate-800 dark:text-slate-100">
                      <ReactMarkdown
                        components={{
                          p: ({ node, ...props }) => <p {...props} className="text-base md:text-lg leading-relaxed mb-4 last:mb-0" />,
                          ul: ({ node, ...props }) => <ul {...props} className="mb-4 space-y-2 list-none" />,
                          ol: ({ node, ...props }) => <ol {...props} className="mb-4 space-y-2 list-decimal list-inside" />,
                          li: ({ node, ...props }) => (
                            <li className="flex items-start gap-2 text-base md:text-lg">
                              <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                              <span {...props} />
                            </li>
                          ),
                          h1: ({ node, ...props }) => <h1 {...props} className="text-2xl font-black mb-4 tracking-tight" />,
                          h2: ({ node, ...props }) => <h2 {...props} className="text-xl font-bold mb-3 tracking-tight" />,
                          h3: ({ node, ...props }) => <h3 {...props} className="text-lg font-bold mb-2 tracking-tight" />,
                          strong: ({ node, ...props }) => <strong {...props} className="font-bold text-slate-900 dark:text-white" />,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}

              {/* Thinking Indicator */}
              {status === 'processing' && (
                <div className="flex items-start gap-4 animate-pulse">
                  <div className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0 border border-slate-200 dark:border-white/10">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                  </div>
                  <div className="flex-1 pt-2">
                    <div className="h-4 bg-slate-100 dark:bg-white/5 rounded-full w-24 mb-2" />
                    <div className="h-3 bg-slate-100 dark:bg-white/5 rounded-full w-48 opacity-50" />
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="mx-auto max-w-2xl p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex items-start gap-3 animate-in shake-1">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-red-800 dark:text-red-400 uppercase tracking-wider">System Error</p>
                    <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">{error}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-4" />
            </div>
          </ScrollArea>
        </main>

        {/* Input Area */}
        <footer className="p-4 bg-white dark:bg-[#0a0a0a] border-t border-slate-200/60 dark:border-white/5 z-40">
          <form onSubmit={handleSend} className="relative group max-w-4xl mx-auto">
            <div className="relative flex items-center gap-2 p-2 rounded-2xl bg-slate-50 dark:bg-white/3 border border-slate-200 dark:border-white/10 focus-within:border-blue-500/50 transition-all duration-300">
              <Input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={hasPendingMultiSelect ? "Select above..." : status === 'ready' ? "Ask anything..." : "..."}
                disabled={status !== 'ready' || hasPendingMultiSelect}
                className="flex-1 bg-transparent border-none h-10 px-3 text-sm focus-visible:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              <Button
                type="submit"
                disabled={!inputMessage.trim() || status !== 'ready' || hasPendingMultiSelect}
                className={cn(
                  "h-10 w-10 rounded-xl transition-all duration-300",
                  inputMessage.trim() && status === 'ready'
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-200 dark:bg-white/5 text-slate-400 opacity-50'
                )}
                size="icon"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </footer>
      </div>

    </div>
  );
}
