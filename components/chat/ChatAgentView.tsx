'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Brain, Send, StopCircle, Loader2, Sparkles, Moon, Sun, User, Search, FileText, Lightbulb, MessageSquare, CheckCircle2, XCircle } from 'lucide-react';

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
  const [showBrain, setShowBrain] = useState(false);
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
      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${config.bg} ${config.text} text-[10px] font-medium tracking-wide uppercase`}>
        {config.icon}
        {config.label}
      </div>
    );
  };

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-screen w-full flex overflow-hidden`}>
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0a0a0a] transition-colors duration-300">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-slate-100 dark:border-white/5 bg-white/50 dark:bg-black/20 backdrop-blur-xl z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-linear-to-tr from-blue-600 to-indigo-600">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-semibold text-slate-800 dark:text-white tracking-tight">
                Nexus<span className="text-blue-600 font-bold italic">Research</span>
              </h1>
            </div>
            <div className="h-4 w-px bg-slate-200 dark:bg-white/10 mx-1" />
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-3">
            <Sheet open={showBrain} onOpenChange={setShowBrain}>
              <SheetTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`gap-2 h-9 px-4 rounded-full transition-all duration-300 ${
                    brain ? 'bg-blue-600/10 text-blue-600 hover:bg-blue-600/20' : 'text-slate-500'
                  }`}
                >
                  <Brain className="w-4 h-4" />
                  <span className="hidden sm:inline">Research Brain</span>
                  {brain && <span className="flex h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse ml-0.5" />}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:w-[500px] bg-white dark:bg-[#0a0a0a] border-l border-slate-100 dark:border-white/5 p-0 flex flex-col shadow-2xl">
                <div className="flex flex-col h-full overflow-hidden">
                  <div className="p-5 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 backdrop-blur-md">
                    <SheetHeader>
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className="p-2 rounded-xl bg-blue-600/10 shrink-0">
                          <Brain className="w-5 h-5 text-blue-600" />
                        </div>
                        <SheetTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Knowledge Vault</SheetTitle>
                      </div>
                      <SheetDescription className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        Synthesized intelligence from the active research pipeline.
                      </SheetDescription>
                    </SheetHeader>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="p-6">
                      {brain ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none
                          prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-white
                          prose-p:text-slate-600 dark:prose-p:text-slate-300 prose-p:leading-relaxed
                          prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                          prose-strong:text-slate-900 dark:prose-strong:text-white prose-strong:font-semibold
                          prose-code:text-slate-900 dark:prose-code:text-slate-100 prose-code:bg-slate-100 dark:prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:before:content-[''] prose-code:after:content-['']
                          prose-pre:bg-slate-950 prose-pre:border prose-pre:border-white/5 prose-pre:text-slate-100
                          prose-li:text-slate-600 dark:prose-li:text-slate-300
                          prose-table:border-collapse prose-th:border prose-th:border-slate-200 dark:prose-th:border-white/10 prose-th:bg-slate-50 dark:prose-th:bg-white/5 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold
                          prose-td:border prose-td:border-slate-200 dark:prose-td:border-white/10 prose-td:px-3 prose-td:py-2">
                          <ReactMarkdown
                            components={{
                              a: ({ node, ...props }) => (
                                <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                              ),
                              code: ({ node, inline, ...props }) => (
                                inline
                                  ? <code {...props} className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-slate-100 text-[12px]" />
                                  : <code {...props} className="block p-3 rounded bg-slate-950 dark:bg-black/50 text-slate-100 text-[12px] overflow-x-auto" />
                              ),
                            }}
                          >
                            {brain}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="h-[60vh] flex flex-col items-center justify-center text-center px-10">
                          <div className="w-16 h-16 rounded-3xl bg-slate-50 dark:bg-white/5 flex items-center justify-center mb-5 animate-pulse">
                            <Brain className="w-8 h-8 text-slate-300 dark:text-white/10" />
                          </div>
                          <h3 className="text-slate-900 dark:text-white font-semibold mb-2">Vault Initializing</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[200px] leading-relaxed">
                            Insights will appear here as the agent discovers them.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <div className="h-8 w-px bg-slate-200 dark:bg-white/10 mx-1" />

            <Button 
              variant="ghost" 
              size="icon" 
              className="rounded-full w-9 h-9 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
              onClick={() => setIsDarkMode(!isDarkMode)}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            
            {isResearching && (
              <Button
                onClick={stopResearch}
                variant="destructive"
                size="sm"
                className="rounded-full h-8 px-4 bg-red-500 hover:bg-red-600 text-white border-none shadow-lg shadow-red-500/20"
              >
                <StopCircle className="w-3.5 h-3.5 mr-2" />
                Stop
              </Button>
            )}
          </div>
        </header>

        {/* Main Chat Area */}
        <main className="flex-1 overflow-hidden relative">
          <ScrollArea className="h-full px-4 sm:px-6">
            <div className="max-w-3xl mx-auto py-1 space-y-1">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`group flex animate-in fade-in slide-in-from-bottom-2 duration-500 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div className={`flex gap-2.5 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center shadow-sm ${
                      msg.role === 'assistant' 
                        ? 'bg-linear-to-tr from-blue-600 to-indigo-600 text-white' 
                        : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/70'
                    }`}>
                      {msg.role === 'assistant' ? <Sparkles className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    </div>

                    <div className={`space-y-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {/* Research Step Icon (if applicable) */}
                      {msg.role === 'assistant' && msg.metadata?.researchStep && (
                        <div className="flex items-center gap-1 mb-0.5 px-1 animate-in fade-in duration-300">
                          {msg.metadata.researchStep === 'searching' && <Search className="w-2.5 h-2.5 text-blue-500" />}
                          {msg.metadata.researchStep === 'result' && <FileText className="w-2.5 h-2.5 text-emerald-500" />}
                          {msg.metadata.researchStep === 'reasoning' && <Lightbulb className="w-2.5 h-2.5 text-amber-500" />}
                          {msg.metadata.researchStep === 'question' && <MessageSquare className="w-2.5 h-2.5 text-indigo-500" />}
                          {msg.metadata.researchStep === 'complete' && <CheckCircle2 className="w-2.5 h-2.5 text-blue-600" />}
                          {msg.metadata.researchStep === 'stopped' && <XCircle className="w-2.5 h-2.5 text-slate-400" />}
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                            {msg.metadata.researchStep}
                          </span>
                        </div>
                      )}

                      {/* Message Content */}
                      <div className={`px-3 py-1.5 rounded-2xl shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-50 dark:bg-white/5 dark:border dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-tl-none'
                      }`}>
                        {msg.role === 'user' ? (
                          <p className="text-[13px] leading-tight whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed prose-headings:font-semibold prose-headings:text-slate-900 dark:prose-headings:text-white prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900 dark:prose-strong:text-white prose-code:text-slate-900 dark:prose-code:text-slate-100 prose-code:bg-slate-100 dark:prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-slate-900 dark:prose-pre:bg-black/50 prose-pre:text-slate-100">
                            <ReactMarkdown
                              components={{
                                a: ({ node, ...props }) => (
                                  <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                                ),
                                code: ({ node, inline, ...props }) => (
                                  inline
                                    ? <code {...props} className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-slate-100 text-[12px]" />
                                    : <code {...props} className="block p-2 rounded bg-slate-900 dark:bg-black/50 text-slate-100 text-[12px] overflow-x-auto" />
                                ),
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
              {isResearching && (
                <div className="flex justify-center py-2 animate-in fade-in zoom-in-95 duration-500">
                  <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-blue-500/5 border border-blue-500/10 backdrop-blur-sm shadow-sm">
                    <div className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </div>
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest whitespace-nowrap">
                      Pipeline Active
                    </span>
                    <div className="h-3 w-px bg-blue-500/20 shrink-0" />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[250px]">
                      {researchProgress.objective}
                    </span>
                    <div className="h-3 w-px bg-blue-500/20 shrink-0" />
                    <span className="text-[10px] font-mono text-slate-400 font-bold whitespace-nowrap">
                      STEP {researchProgress.iteration || 1}
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex justify-center p-6 bg-red-500/5 border border-red-500/20 rounded-2xl animate-in shake duration-500">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
                      <StopCircle className="w-5 h-5 text-red-500" />
                    </div>
                    <h4 className="text-sm font-bold text-red-500 uppercase tracking-tight mb-1">Research Interrupted</h4>
                    <p className="text-xs text-red-400 max-w-md leading-relaxed">{error}</p>
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
        <footer className="p-3 bg-white dark:bg-[#0a0a0a]">
          <div className="max-w-3xl mx-auto relative">
            <form 
              onSubmit={handleSend}
              className="relative group transition-all duration-300"
            >
              <div className="absolute -inset-0.5 bg-linear-to-r from-blue-500 to-indigo-600 rounded-2xl opacity-0 group-focus-within:opacity-20 transition-opacity blur-sm" />
              
              <div className="relative flex items-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-1 focus-within:border-blue-500/50 focus-within:bg-white dark:focus-within:bg-black/40 transition-all duration-300">
                <Input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={status === 'ready' ? "Ask the Nexus Research Agent..." : "Agent is busy..."}
                  disabled={status !== 'ready'}
                  className="flex-1 bg-transparent border-none shadow-none focus-visible:ring-0 text-slate-800 dark:text-white h-10 px-4 placeholder:text-slate-400 dark:placeholder:text-white/20 text-sm"
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() || status !== 'ready'}
                  className={`h-8 w-8 rounded-xl transition-all duration-300 ${
                    inputMessage.trim() && status === 'ready' 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40 translate-y-0 scale-100' 
                      : 'bg-slate-200 dark:bg-white/5 text-slate-400 scale-95 opacity-50'
                  }`}
                  size="icon"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </form>
            
            <p className="mt-2 text-[9px] text-center text-slate-400 uppercase font-bold tracking-[0.2em]">
              Autonomous Research Pipeline • v2.0-Alpha
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
