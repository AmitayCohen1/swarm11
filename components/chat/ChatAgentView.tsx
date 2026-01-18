'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Brain, Send, StopCircle, Loader2, Sparkles, Moon, Sun, User } from 'lucide-react';

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
      researching: { bg: 'bg-purple-500/10', text: 'text-purple-500', label: 'Researching', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
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
        <header className="h-16 flex items-center justify-between px-6 border-b border-slate-100 dark:border-white/5 bg-white/50 dark:bg-black/20 backdrop-blur-xl z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-linear-to-tr from-indigo-500 via-purple-500 to-pink-500">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h1 className="font-semibold text-slate-800 dark:text-white tracking-tight">
                Nexus<span className="text-purple-500 font-bold italic">Research</span>
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
                    brain ? 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20' : 'text-slate-500'
                  }`}
                >
                  <Brain className="w-4 h-4" />
                  <span className="hidden sm:inline">Research Brain</span>
                  {brain && <span className="flex h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse ml-0.5" />}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-xl dark:bg-[#0f0f0f] border-white/5 p-0">
                <div className="h-full flex flex-col">
                  <div className="p-6 border-b border-white/5">
                    <SheetHeader>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="p-2 rounded-lg bg-purple-500/10">
                          <Brain className="w-5 h-5 text-purple-500" />
                        </div>
                        <SheetTitle className="text-xl">Knowledge Vault</SheetTitle>
                      </div>
                      <SheetDescription className="dark:text-slate-400">
                        Synthesized intelligence from your research sessions.
                      </SheetDescription>
                    </SheetHeader>
                  </div>
                  
                  <ScrollArea className="flex-1 p-6">
                    {brain ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/5">
                        <ReactMarkdown>{brain}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="h-[60vh] flex flex-col items-center justify-center text-center px-10">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4">
                          <Brain className="w-8 h-8 text-slate-300 dark:text-white/20" />
                        </div>
                        <h3 className="text-slate-800 dark:text-white font-medium mb-1">Vault is Empty</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Your agent hasn't found any significant insights yet. Start a research query to begin.
                        </p>
                      </div>
                    )}
                  </ScrollArea>
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
            <div className="max-w-3xl mx-auto py-10 space-y-10">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`group flex animate-in fade-in slide-in-from-bottom-2 duration-500 ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div className={`flex gap-4 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    <div className={`mt-1 shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
                      msg.role === 'assistant' 
                        ? 'bg-linear-to-tr from-indigo-500 to-purple-600 text-white' 
                        : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/70'
                    }`}>
                      {msg.role === 'assistant' ? <Sparkles className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    </div>

                    <div className={`space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {/* Message Content */}
                      <div className={`px-4 py-3 rounded-2xl shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-50 dark:bg-white/5 dark:border dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-tl-none'
                      }`}>
                        {msg.role === 'user' ? (
                          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
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
                <div className="flex justify-start animate-in fade-in duration-700">
                  <div className="flex gap-4 max-w-[85%]">
                    <div className="w-8 h-8 rounded-full bg-linear-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                    <div className="space-y-3">
                      <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl p-6 shadow-sm">
                        <div className="flex flex-col gap-4">
                          <div className="flex items-center gap-3">
                            <div className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                            </div>
                            <span className="text-sm font-semibold dark:text-white">Active Research Pipeline</span>
                          </div>
                          
                          {researchProgress.objective && (
                            <div className="bg-white dark:bg-black/20 rounded-xl p-3 border border-slate-100 dark:border-white/5">
                              <span className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">Objective</span>
                              <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                                {researchProgress.objective}
                              </p>
                            </div>
                          )}

                          <div className="flex items-center gap-4">
                            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-linear-to-r from-indigo-500 to-purple-500 animate-[loading_2s_ease-in-out_infinite] w-1/3 rounded-full" />
                            </div>
                            <span className="text-xs text-slate-500 font-medium tabular-nums">
                              Step {researchProgress.iteration || 1}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium uppercase px-2 tracking-widest">
                        Consulting external networks...
                      </span>
                    </div>
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
        <footer className="p-6 bg-white dark:bg-[#0a0a0a]">
          <div className="max-w-3xl mx-auto relative">
            <form 
              onSubmit={handleSend}
              className="relative group transition-all duration-300"
            >
              <div className="absolute -inset-0.5 bg-linear-to-r from-indigo-500 to-purple-600 rounded-2xl opacity-0 group-focus-within:opacity-20 transition-opacity blur-sm" />
              
              <div className="relative flex items-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-1.5 focus-within:border-indigo-500/50 focus-within:bg-white dark:focus-within:bg-black/40 transition-all duration-300">
                <Input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={status === 'ready' ? "Ask the Nexus Research Agent..." : "Agent is busy..."}
                  disabled={status !== 'ready'}
                  className="flex-1 bg-transparent border-none shadow-none focus-visible:ring-0 text-slate-800 dark:text-white h-11 px-4 placeholder:text-slate-400 dark:placeholder:text-white/20"
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() || status !== 'ready'}
                  className={`h-10 w-10 rounded-xl transition-all duration-300 ${
                    inputMessage.trim() && status === 'ready' 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/40 translate-y-0 scale-100' 
                      : 'bg-slate-200 dark:bg-white/5 text-slate-400 scale-95 opacity-50'
                  }`}
                  size="icon"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
            
            <p className="mt-3 text-[10px] text-center text-slate-400 uppercase font-bold tracking-[0.2em]">
              Autonomous Research Pipeline • v2.0-Alpha
            </p>
          </div>
        </footer>
      </div>
      
      {/* Dynamic Keyframes for the loading bar */}
      <style jsx global>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
