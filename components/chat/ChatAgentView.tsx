'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, StopCircle, Loader2, Sparkles, Moon, Sun, User, Search, FileText, Lightbulb, ChevronRight, Activity, PenLine } from 'lucide-react';

// Component for ask_user questions with options + write your own (single-select)
function AskUserOptions({
  question,
  options,
  status,
  onSelect
}: {
  question: string;
  options: { label: string; description?: string }[];
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

  // If something was selected, show simplified view
  if (selected) {
    return (
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-slate-500 dark:text-slate-400 text-sm">{question}</p>
          <span className="inline-flex px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
            {selected}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </div>
      <div className="flex-1 space-y-3">
        <p className="text-slate-800 dark:text-slate-100 text-base">{question}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleSelect(opt.label)}
              disabled={status !== 'ready'}
              className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20"
            >
              {opt.label}
            </button>
          ))}
          {!showInput && (
            <button
              onClick={() => setShowInput(true)}
              disabled={status !== 'ready'}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-dashed border-slate-300 dark:border-white/20 bg-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-400 dark:hover:border-white/30 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <PenLine className="w-3.5 h-3.5" />
              Write your own
            </button>
          )}
        </div>
        {showInput && (
          <div className="flex gap-2">
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
              className="flex-1 h-9 text-sm bg-white dark:bg-white/5 border-slate-200 dark:border-white/10"
            />
            <Button
              onClick={handleSubmitCustom}
              disabled={!customInput.trim() || status !== 'ready'}
              size="sm"
              className="h-9 px-3 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
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
              className="h-9 px-3 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatAgentView() {
  const {
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    brain,
    sendMessage,
    stopResearch
  } = useChatAgent();

  const [inputMessage, setInputMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
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
    const variants = {
      initializing: { text: 'text-slate-500 dark:text-slate-400', label: 'Initializing' },
      ready: { text: 'text-emerald-600 dark:text-emerald-400', label: 'Ready' },
      processing: { text: 'text-blue-600 dark:text-blue-400', label: 'Processing' },
      researching: { text: 'text-blue-600 dark:text-blue-400', label: 'Researching' },
      error: { text: 'text-red-600 dark:text-red-400', label: 'Error' }
    };

    const config = variants[status as keyof typeof variants] || variants.ready;

    return (
      <span className={`${config.text} font-semibold text-xs`}>
        {config.label}
      </span>
    );
  };

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-screen w-full flex overflow-hidden`}>
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0a0a0a] transition-colors duration-300">
        {/* Header - Compact */}
        <header className="h-12 flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/5 bg-white dark:bg-black/40 text-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-bold text-slate-800 dark:text-white">
                Swarm<span className="text-blue-600">10</span>
              </span>
            </div>
            <div className="h-3 w-px bg-slate-200 dark:bg-white/10" />
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
              onClick={() => setIsDarkMode(!isDarkMode)}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            {isResearching && (
              <Button
                onClick={stopResearch}
                variant="destructive"
                size="sm"
                className="h-8 px-3 bg-red-500/90 hover:bg-red-600 text-white text-xs font-semibold"
              >
                <StopCircle className="w-3.5 h-3.5 mr-1.5" />
                Stop
              </Button>
            )}
          </div>
        </header>

        {/* Research Objective Banner */}
        {isResearching && researchProgress?.objective && (
          <div className="px-6 py-3 bg-blue-50 dark:bg-blue-500/10 border-b border-blue-100 dark:border-blue-500/20">
            <div className="max-w-5xl mx-auto flex items-start gap-3">
              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Researching</p>
                <p className="text-sm text-blue-900 dark:text-blue-100 mt-0.5">{researchProgress.objective}</p>
              </div>
            </div>
          </div>
        )}

        {/* Main Chat Area - Log Style */}
        <main className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full px-6 sm:px-8">
            <div className="max-w-5xl mx-auto py-6 space-y-3">
              {messages.map((msg, idx) => {
                if (msg.metadata?.type === 'research_iteration') return null;

                const isUser = msg.role === 'user';
                const isProcessStep = ['research_query', 'agent_thinking', 'search_result', 'search_complete'].includes(msg.metadata?.type);

                return (
                <div key={idx} className="py-2 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                  {isUser ? (
                    // User message - clean and prominent
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="flex-1 pt-0.5">
                        <p className="text-slate-900 dark:text-white text-base leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  ) : msg.metadata?.type === 'research_query' ? (
                    // Standalone search query (waiting for results)
                    <div className="ml-2">
                      <div className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10">
                        <Search className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{msg.metadata.query}</span>
                        <Loader2 className="w-3 h-3 text-slate-400 animate-spin ml-1" />
                      </div>
                    </div>
                  ) : msg.metadata?.type === 'agent_thinking' ? (
                    // Thinking - subtle and minimal
                    <div className="ml-2 flex items-start gap-2 text-slate-500 dark:text-slate-400">
                      <Lightbulb className="w-4 h-4 mt-0.5 shrink-0" />
                      <p className="text-sm">{msg.metadata.thinking}</p>
                    </div>
                  ) : msg.metadata?.type === 'ask_user' ? (
                    // Question with selectable options
                    <AskUserOptions
                      question={msg.metadata.question}
                      options={msg.metadata.options || []}
                      status={status}
                      onSelect={(value) => sendMessage(value)}
                    />
                  ) : (msg.metadata?.type === 'search_result' || msg.metadata?.type === 'search_complete') ? (
                    // Search + Results card
                    <div className="ml-2 rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden bg-slate-50/50 dark:bg-white/[0.02]">
                      {/* Search query header */}
                      {msg.metadata.query && (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                          <span className="text-sm text-slate-600 dark:text-slate-300">{msg.metadata.query}</span>
                        </div>
                      )}
                      {/* Results body */}
                      <div className="px-4 py-3">
                        <div className="text-slate-800 dark:text-white/90">
                          <ReactMarkdown
                            components={{
                              p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0 leading-relaxed text-sm" />,
                              a: ({ node, ...props }) => (
                                <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                              ),
                              strong: ({ node, ...props }) => <strong {...props} className="font-semibold" />,
                              code: (rawProps: any) => {
                                const { inline, ...props } = rawProps || {};
                                return inline
                                  ? <code {...props} className="px-1 py-0.5 bg-slate-200 dark:bg-white/10 rounded text-xs" />
                                  : <code {...props} className="block p-2 bg-slate-900 dark:bg-black/50 rounded text-xs overflow-x-auto my-2" />;
                              },
                            }}
                          >
                            {msg.metadata.answer}
                          </ReactMarkdown>
                        </div>
                        {/* Sources */}
                        {msg.metadata.sources && msg.metadata.sources.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
                            {msg.metadata.sources.slice(0, 3).map((s: any, i: number) => (
                              <a
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white transition-colors"
                              >
                                <FileText className="w-3 h-3" />
                                <span className="truncate max-w-[200px]">{s.title}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Agent response - clean with sparkle icon
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 pt-0.5 text-slate-800 dark:text-slate-100">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p {...props} className="mb-3 last:mb-0 leading-relaxed text-base" />,
                            ul: ({ node, ...props }) => <ul {...props} className="mb-3 space-y-1.5 list-disc list-inside" />,
                            ol: ({ node, ...props }) => <ol {...props} className="mb-3 space-y-1.5 list-decimal list-inside" />,
                            li: ({ node, ...props }) => <li {...props} className="text-base leading-relaxed" />,
                            h1: ({ node, ...props }) => <h1 {...props} className="text-lg font-semibold mb-2 text-slate-900 dark:text-white" />,
                            h2: ({ node, ...props }) => <h2 {...props} className="text-base font-semibold mb-2 text-slate-900 dark:text-white" />,
                            h3: ({ node, ...props }) => <h3 {...props} className="text-base font-medium mb-1.5 text-slate-900 dark:text-white" />,
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                            ),
                            strong: ({ node, ...props }) => <strong {...props} className="font-semibold text-slate-900 dark:text-white" />,
                            code: (rawProps: any) => {
                              const { inline, ...props } = rawProps || {};
                              return inline
                                ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm font-mono" />
                                : <code {...props} className="block p-3 bg-slate-100 dark:bg-black/40 rounded-lg text-sm overflow-x-auto my-2 font-mono" />;
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}

              {/* Error Display */}
              {error && (
                <div className="ml-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                  <div className="flex items-start gap-2">
                    <StopCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </main>

        {/* Input Area */}
        <footer className="p-4 bg-white dark:bg-[#0a0a0a] border-t border-slate-200 dark:border-white/5">
          <form onSubmit={handleSend} className="flex items-center gap-3 max-w-5xl mx-auto">
            <Input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={status === 'ready' ? "Type your message..." : "Busy..."}
              disabled={status !== 'ready'}
              className="flex-1 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 h-11 px-4 text-base focus-visible:ring-1 focus-visible:ring-blue-500"
            />
            <Button
              type="submit"
              disabled={!inputMessage.trim() || status !== 'ready'}
              className={`h-11 px-5 text-sm font-semibold ${
                inputMessage.trim() && status === 'ready'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 dark:bg-white/5 text-slate-400 opacity-50'
              }`}
              size="sm"
            >
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </form>
        </footer>
      </div>
    </div>
  );
}
