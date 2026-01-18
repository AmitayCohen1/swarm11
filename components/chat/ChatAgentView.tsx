'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, StopCircle, Loader2, Sparkles, Moon, Sun, User, Search, FileText, Lightbulb, ChevronRight, Activity } from 'lucide-react';

export default function ChatAgentView() {
  const {
    status,
    messages,
    error,
    isResearching,
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
                    <div className="flex gap-3 items-start">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                        <User className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">[USER]</span>
                      </div>
                      <div className="break-words text-slate-900 dark:text-white">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p {...props} className="mb-2 leading-relaxed text-base" />,
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                            ),
                            strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
                            code: (rawProps: any) => {
                              const { inline, ...props } = rawProps || {};
                              return inline
                                ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm" />
                                : <code {...props} className="block p-3 bg-slate-900 dark:bg-black/50 rounded text-sm overflow-x-auto my-2" />;
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : msg.metadata?.type === 'research_query' ? (
                    <div className="flex gap-3 items-start">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                        <Search className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">[SEARCH]</span>
                      </div>
                      <span className="break-words text-base leading-relaxed text-slate-700 dark:text-slate-200">{msg.metadata.query}</span>
                    </div>
                  ) : msg.metadata?.type === 'agent_thinking' ? (
                    <div className="flex gap-3 items-start">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                        <Lightbulb className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">[THINK]</span>
                      </div>
                      <div className="break-words text-slate-600 dark:text-slate-300 italic">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p {...props} className="mb-2 leading-relaxed text-base" />,
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="hover:underline" />
                            ),
                            strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
                            code: (rawProps: any) => {
                              const { inline, ...props } = rawProps || {};
                              return inline
                                ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm not-italic" />
                                : <code {...props} className="block p-3 bg-slate-900 dark:bg-black/50 rounded text-sm overflow-x-auto my-2 not-italic" />;
                            },
                          }}
                        >
                          {msg.metadata.thinking || `${msg.metadata.evaluation || ''} ${msg.metadata.reasoning || ''}`}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (msg.metadata?.type === 'search_result' || msg.metadata?.type === 'search_complete') ? (
                    <div className="space-y-2">
                      {msg.metadata.query && (
                        <div className="flex gap-3 items-start">
                          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                            <Search className="w-4 h-4" />
                            <span className="text-xs font-semibold uppercase tracking-wider">[SEARCH]</span>
                          </div>
                          <span className="break-words text-base leading-relaxed text-slate-700 dark:text-slate-200">{msg.metadata.query}</span>
                        </div>
                      )}
                      <div className="flex gap-3 items-start">
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                          <FileText className="w-4 h-4" />
                          <span className="text-xs font-semibold uppercase tracking-wider">[FOUND]</span>
                        </div>
                        <div className="break-words text-slate-800 dark:text-white/90">
                          <ReactMarkdown
                            components={{
                              p: ({ node, ...props }) => <p {...props} className="mb-2 leading-relaxed text-base" />,
                              a: ({ node, ...props }) => (
                                <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                              ),
                              strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
                              code: (rawProps: any) => {
                                const { inline, ...props } = rawProps || {};
                                return inline
                                  ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm" />
                                  : <code {...props} className="block p-3 bg-slate-900 dark:bg-black/50 rounded text-sm overflow-x-auto my-2" />;
                              },
                            }}
                          >
                            {msg.metadata.answer}
                          </ReactMarkdown>
                        </div>
                      </div>
                      {msg.metadata.sources && msg.metadata.sources.length > 0 && (
                        <div className="flex gap-2 text-slate-500 dark:text-slate-400 text-sm pl-[108px]">
                          <span className="shrink-0">└─</span>
                          <span className="break-words">
                            {msg.metadata.sources.slice(0, 3).map((s: any, i: number) => (
                              <a
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-slate-700 dark:hover:text-white hover:underline mr-4"
                              >
                                [{i + 1}] {s.title}
                              </a>
                            ))}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-3 items-start">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                        <Sparkles className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">[AGENT]</span>
                      </div>
                      <div className="break-words text-slate-900 dark:text-white">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p {...props} className="mb-3 leading-relaxed text-base" />,
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                            ),
                            strong: ({ node, ...props }) => <strong {...props} className="font-bold text-slate-900 dark:text-white" />,
                            code: (rawProps: any) => {
                              const { inline, ...props } = rawProps || {};
                              return inline
                                ? <code {...props} className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm" />
                                : <code {...props} className="block p-3 bg-slate-900 dark:bg-black/50 rounded text-sm overflow-x-auto my-2" />;
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
                <div className="py-2">
                  <div className="flex gap-3 items-start">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                      <StopCircle className="w-4 h-4" />
                      <span className="text-xs font-semibold uppercase tracking-wider">[ERROR]</span>
                    </div>
                    <span className="break-words text-base leading-relaxed text-slate-900 dark:text-white">{error}</span>
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
