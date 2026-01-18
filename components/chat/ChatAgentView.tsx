'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, Send, StopCircle, Loader2, Sparkles, Moon, Sun, User, Search, FileText, Lightbulb, CheckCircle2, XCircle } from 'lucide-react';

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
      initializing: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', label: 'Initializing', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
      ready: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', label: 'Online', icon: <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> },
      processing: { bg: 'bg-blue-500/10', text: 'text-blue-500', label: 'Thinking', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
      researching: { bg: 'bg-blue-500/10', text: 'text-blue-500', label: 'Researching', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
      error: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Error', icon: null }
    };

    const config = variants[status as keyof typeof variants] || variants.ready;

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bg} ${config.text} text-[11px] font-semibold tracking-wide uppercase`}>
        {config.icon}
        {config.label}
      </div>
    );
  };

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-screen w-full flex overflow-hidden`}>
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0a0a0a] transition-colors duration-300">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-slate-100 dark:border-white/5 bg-white/50 dark:bg-black/20 backdrop-blur-xl z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-linear-to-tr from-blue-600 to-indigo-600 shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
                Swarm<span className="text-blue-600 font-extrabold">10</span>
              </h1>
            </div>
            <div className="h-5 w-px bg-slate-200 dark:bg-white/10 mx-1" />
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-10 h-10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              onClick={() => setIsDarkMode(!isDarkMode)}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            
            {isResearching && (
              <Button
                onClick={stopResearch}
                variant="destructive"
                size="sm"
                className="rounded-full h-10 px-5 bg-red-500 hover:bg-red-600 text-white border-none shadow-lg shadow-red-500/20 font-medium text-sm"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop Research
              </Button>
            )}
          </div>
        </header>

        {/* Main Chat Area */}
        <main className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full px-4 sm:px-6">
            <div className="max-w-4xl mx-auto py-4 space-y-3">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`group flex animate-in fade-in slide-in-from-bottom-2 duration-500 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div className={`flex gap-2.5 max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm ${
                      msg.role === 'assistant'
                        ? 'bg-linear-to-tr from-blue-600 to-indigo-600 text-white'
                        : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/70'
                    }`}>
                      {msg.role === 'assistant' ? <Sparkles className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                    </div>

                    <div className={`space-y-1.5 flex-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {/* Research Step Icon (if applicable) */}
                      {msg.role === 'assistant' && msg.metadata?.researchStep && (
                        <div className="flex items-center gap-1 mb-0.5 animate-in fade-in duration-300">
                          {msg.metadata.researchStep === 'searching' && <Search className="w-2.5 h-2.5 text-blue-500" />}
                          {msg.metadata.researchStep === 'result' && <FileText className="w-2.5 h-2.5 text-emerald-500" />}
                          {msg.metadata.researchStep === 'reasoning' && <Lightbulb className="w-2.5 h-2.5 text-amber-500" />}
                          {msg.metadata.researchStep === 'complete' && <CheckCircle2 className="w-2.5 h-2.5 text-blue-600" />}
                          {msg.metadata.researchStep === 'stopped' && <XCircle className="w-2.5 h-2.5 text-slate-400" />}
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                            {msg.metadata.researchStep}
                          </span>
                        </div>
                      )}

                      {/* Message Content */}
                      <div className={`px-3 py-2 rounded-xl shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : msg.metadata?.type === 'agent_thinking' || msg.metadata?.type === 'research_query' || msg.metadata?.type === 'search_result'
                          ? 'bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 text-slate-700 dark:text-slate-300'
                          : 'bg-slate-50 dark:bg-white/5 dark:border dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-tl-none'
                      }`}>
                        {msg.role === 'user' ? (
                          <p className="text-[13px] leading-snug whitespace-pre-wrap">{msg.content}</p>
                        ) : msg.metadata?.type === 'research_query' ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Search className="w-4 h-4 text-blue-500 shrink-0" />
                            <span className="font-semibold text-blue-600 dark:text-blue-400">Searching:</span>
                            <span className="italic">"{msg.metadata.query}"</span>
                          </div>
                        ) : msg.metadata?.type === 'agent_thinking' ? (
                          <div className="flex items-start gap-2 text-sm">
                            <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div className="text-slate-600 dark:text-slate-300 italic">{msg.metadata.thinking}</div>
                          </div>
                        ) : msg.metadata?.type === 'search_result' ? (
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Found Results</span>
                            </div>
                            <div className="pl-6 text-slate-600 dark:text-slate-300 line-clamp-3 hover:line-clamp-none transition-all">
                              {msg.metadata.answer}
                            </div>
                            {msg.metadata.sources && msg.metadata.sources.length > 0 && (
                              <div className="pl-6 pt-1 flex flex-wrap gap-2">
                                {msg.metadata.sources.slice(0, 3).map((s: any, idx: number) => (
                                  <a
                                    key={idx}
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-full text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[150px]"
                                  >
                                    {s.title || 'Source'}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-snug prose-headings:font-semibold prose-headings:text-slate-900 dark:prose-headings:text-white prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900 dark:prose-strong:text-white prose-code:text-slate-900 dark:prose-code:text-slate-100 prose-code:bg-slate-100 dark:prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-slate-900 dark:prose-pre:bg-black/50 prose-pre:text-slate-100">
                            <ReactMarkdown
                              components={{
                                a: ({ node, ...props }) => (
                                  <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                                ),
                                code: (rawProps: any) => {
                                  const { inline, ...props } = rawProps || {};
                                  return inline
                                    ? <code {...props} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-slate-100 text-[13px]" />
                                    : <code {...props} className="block p-3 rounded bg-slate-900 dark:bg-black/50 text-slate-100 text-[13px] overflow-x-auto" />;
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>

                      {/* Footer Info */}
                      <div className={`flex items-center gap-3 px-1 transition-opacity duration-300 ${
                        msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                      }`}>
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        
                        {msg.metadata && (
                          <div className="flex gap-2">
                            {msg.metadata.iterations && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-[10px] text-slate-500 font-medium">
                                {msg.metadata.iterations} Iterations
                              </span>
                            )}
                            {msg.metadata.creditsUsed && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-medium">
                                {msg.metadata.creditsUsed} Credits
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Dynamic Progress States */}
              {error && (
                <div className="flex justify-center p-8 bg-red-500/5 border border-red-500/20 rounded-2xl animate-in shake duration-500">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                      <StopCircle className="w-6 h-6 text-red-500" />
                    </div>
                    <h4 className="text-base font-bold text-red-500 uppercase tracking-tight mb-2">Research Interrupted</h4>
                    <p className="text-sm text-red-400 max-w-md leading-relaxed">{error}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Bottom Gradient Overlay */}
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-linear-to-t from-white dark:from-[#0a0a0a] to-transparent pointer-events-none" />
        </main>

        {/* Input Area */}
        <footer className="p-4 bg-white dark:bg-[#0a0a0a]">
          <div className="max-w-3xl mx-auto relative">
            <form
              onSubmit={handleSend}
              className="relative group transition-all duration-300"
            >
              <div className="absolute -inset-0.5 bg-linear-to-r from-blue-500 to-indigo-600 rounded-2xl opacity-0 group-focus-within:opacity-20 transition-opacity blur-sm" />

              <div className="relative flex items-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-1.5 focus-within:border-blue-500/50 focus-within:bg-white dark:focus-within:bg-black/40 transition-all duration-300">
                <Input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={status === 'ready' ? "Ask Swarm10 to research anything..." : "Agent is busy..."}
                  disabled={status !== 'ready'}
                  className="flex-1 bg-transparent border-none shadow-none focus-visible:ring-0 text-slate-800 dark:text-white h-11 px-4 placeholder:text-slate-400 dark:placeholder:text-white/30 text-sm"
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() || status !== 'ready'}
                  className={`h-9 w-9 rounded-xl transition-all duration-300 ${
                    inputMessage.trim() && status === 'ready'
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40 translate-y-0 scale-100'
                      : 'bg-slate-200 dark:bg-white/5 text-slate-400 scale-95 opacity-50'
                  }`}
                  size="icon"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>

            <p className="mt-2.5 text-[10px] text-center text-slate-400 uppercase font-bold tracking-wider">
              Strategic Research Agent • Swarm10
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
