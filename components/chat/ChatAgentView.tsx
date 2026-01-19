'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, 
  StopCircle, 
  Loader2, 
  Sparkles, 
  Moon, 
  Sun, 
  User, 
  Search, 
  Activity, 
  PenLine, 
  Check, 
  ArrowRight,
  Globe,
  Brain,
  MessageSquare,
  AlertCircle
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
 * Component for batch search results (parallel queries)
 */
function SearchBatch({ queries }: { queries: any[] }) {
  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      {queries.map((q, i) => (
        <div key={i} className="group relative pl-11 py-2">
          <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-200 dark:bg-white/10 group-last:bg-transparent" />
          <div className={`absolute left-[9px] top-3 w-2.5 h-2.5 rounded-full border-2 ${
            q.status === 'complete'
              ? 'border-emerald-400 dark:border-emerald-500/60 bg-emerald-50 dark:bg-emerald-500/20'
              : 'border-blue-400 dark:border-blue-500/40 bg-white dark:bg-[#0a0a0a]'
          }`} />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              <span className="text-slate-500 dark:text-slate-400 text-sm font-medium tracking-tight">
                {q.query}
              </span>
              {q.status === 'searching' && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
            </div>

            {q.purpose && (
              <p className="text-slate-400 dark:text-slate-500 text-xs italic ml-5">{q.purpose}</p>
            )}

            {q.answer && (
              <div className="p-4 rounded-2xl bg-white dark:bg-white/3 border border-slate-200/60 dark:border-white/6 shadow-sm mt-1">
                <div className="text-slate-800 dark:text-slate-200 text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                      a: ({ node, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 font-medium hover:underline" />
                      ),
                    }}
                  >
                    {q.answer}
                  </ReactMarkdown>
                </div>

                {q.sources?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                    {q.sources.slice(0, 4).map((s: any, j: number) => (
                      <a
                        key={j}
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
      ))}
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
          <span className="text-slate-500 dark:text-slate-400 text-sm font-medium tracking-tight">
            {msg.metadata.query}
          </span>
          {!msg.metadata.answer && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
        </div>
        
        {msg.metadata.answer && (
          <div className="p-4 rounded-2xl bg-white dark:bg-white/3 border border-slate-200/60 dark:border-white/6 shadow-sm">
            <div className="text-slate-800 dark:text-slate-200 text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
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
 * Component for agent thinking steps
 */
function AgentThinking({ msg }: { msg: any }) {
  return (
    <div className="group relative pl-11 py-2 animate-in fade-in duration-500">
      <div className="absolute left-3.5 top-0 bottom-0 w-px bg-slate-200 dark:bg-white/10 group-last:bg-transparent" />
      <div className="absolute left-[9px] top-3 w-2.5 h-2.5 rounded-full border-2 border-blue-300 dark:border-blue-500/40 bg-white dark:bg-[#0a0a0a]" />

      <div className="p-4 rounded-2xl bg-linear-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-500/5 dark:to-indigo-500/5 border border-blue-100/50 dark:border-blue-500/10 shadow-sm space-y-3">
        {msg.metadata.review && (
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed">{msg.metadata.review}</p>
          </div>
        )}
        {msg.metadata.next && (
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <ArrowRight className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed italic">{msg.metadata.next}</p>
          </div>
        )}
        {msg.metadata.thinking && !msg.metadata.review && (
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-md bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
              <Brain className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            </div>
            <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed">{msg.metadata.thinking}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Component ---

export default function ChatAgentView() {
  const {
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    sendMessage,
    stopResearch
  } = useChatAgent();

  const [inputMessage, setInputMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={cn("h-screen w-full flex overflow-hidden font-sans selection:bg-blue-100 dark:selection:bg-blue-500/30", isDarkMode ? 'dark' : '')}>
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0a0a0a] transition-colors duration-500">
        
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-slate-200/60 dark:border-white/5 bg-white/80 dark:bg-black/40 backdrop-blur-md z-30">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-slate-800 dark:text-white">
                Swarm<span className="text-blue-600">10</span>
              </span>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-white/10 mx-1" />
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
              onClick={() => setIsDarkMode(!isDarkMode)}
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

        {/* Research Objective Banner */}
        {isResearching && researchProgress?.objective && (
          <div className="px-6 py-4 bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border-b border-blue-100 dark:border-blue-500/20 animate-in slide-in-from-top duration-500">
            <div className="max-w-4xl mx-auto flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-white/80 dark:bg-white/5 flex items-center justify-center shrink-0 shadow-sm border border-blue-200/50 dark:border-blue-500/20">
                <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-[0.2em]">Current Mission</p>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">{researchProgress.objective}</p>
              </div>
            </div>
          </div>
        )}

        {/* Chat Content */}
        <main className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full scroll-smooth">
            <div className="max-w-4xl mx-auto py-10 px-6 space-y-8">
              {messages.map((msg, idx) => {
                if (msg.metadata?.type === 'research_iteration') return null;

                const isUser = msg.role === 'user';

                if (isUser) {
                  return (
                    <div key={idx} className="flex flex-col items-end gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex items-start gap-3 max-w-[85%]">
                        <div className="px-5 py-3 rounded-2xl bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-md">
                          <p className="text-sm md:text-base leading-relaxed font-medium">{msg.content}</p>
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
                  return <SearchBatch key={idx} queries={msg.metadata.queries || []} />;
                }
                if (msg.metadata?.type === 'research_query') {
                  return <ResearchQuery key={idx} msg={msg} />;
                }
                if (msg.metadata?.type === 'agent_thinking') {
                  return <AgentThinking key={idx} msg={msg} />;
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
                    <div className="flex-1 pt-1.5 space-y-4">
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
        <footer className="p-6 bg-white dark:bg-[#0a0a0a] border-t border-slate-200/60 dark:border-white/5 z-40">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
            <div className="absolute -inset-1 bg-linear-to-r from-blue-600 to-indigo-600 rounded-[28px] opacity-0 group-focus-within:opacity-10 blur-xl transition-opacity duration-500" />
            <div className="relative flex items-center gap-3 p-2 rounded-[24px] bg-slate-50 dark:bg-white/3 border border-slate-200 dark:border-white/10 focus-within:border-blue-500/50 focus-within:bg-white dark:focus-within:bg-black/40 transition-all duration-300 shadow-sm">
              <Input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={status === 'ready' ? "Ask anything..." : "System busy..."}
                disabled={status !== 'ready'}
                className="flex-1 bg-transparent border-none h-12 px-4 text-base md:text-lg focus-visible:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
              <Button
                type="submit"
                disabled={!inputMessage.trim() || status !== 'ready'}
                className={cn(
                  "h-12 w-12 rounded-2xl transition-all duration-300 shadow-lg",
                  inputMessage.trim() && status === 'ready'
                    ? 'bg-blue-600 text-white shadow-blue-500/20 hover:scale-105 active:scale-95'
                    : 'bg-slate-200 dark:bg-white/5 text-slate-400 opacity-50'
                )}
                size="icon"
              >
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </form>
          <p className="text-center mt-3 text-[10px] text-slate-400 dark:text-slate-600 font-medium uppercase tracking-widest">
            Powered by Swarm10 Autonomous Intelligence
          </p>
        </footer>
      </div>
    </div>
  );
}
