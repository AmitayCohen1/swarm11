'use client';

import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Loader2,
  User,
  Zap,
  Check,
  PenLine,
  Search,
  Telescope,
  CheckCircle,
} from 'lucide-react';
import { useResearchStatus } from './ResearchStatusContext';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

interface ChatPanelProps {
  messages: Message[];
  status: 'idle' | 'initializing' | 'ready' | 'processing' | 'researching' | 'error';
  onSendMessage: (message: string) => void;
  intakeSearch?: { query: string; answer?: string; status: 'searching' | 'complete' } | null;
  className?: string;
}

// Ask User Options Component
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
      <div className="space-y-1.5 animate-in fade-in duration-300">
        <p className="text-[11px] text-slate-500">{question}</p>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Check className="w-2.5 h-2.5" />
          {selected}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/5">
      <div className="flex items-start gap-2">
        <Telescope className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-[12px] text-white font-medium">{question}</p>
          {reason && <p className="text-[10px] text-slate-500 mt-0.5">{reason}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-6">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt.label)}
            disabled={status !== 'ready'}
            className="px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-all disabled:opacity-50 border-white/10 bg-white/5 text-slate-300 hover:bg-white hover:text-black hover:border-white active:scale-95"
          >
            {opt.label}
          </button>
        ))}
        {!showInput && (
          <button
            onClick={() => setShowInput(true)}
            disabled={status !== 'ready'}
            className="px-2.5 py-1 text-[10px] font-medium rounded-lg border border-dashed border-white/20 text-slate-500 hover:border-white/40 hover:text-white transition-all flex items-center gap-1"
          >
            <PenLine className="w-2.5 h-2.5" />
            Other
          </button>
        )}
      </div>

      {showInput && (
        <div className="flex gap-1.5 pl-6">
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
            className="flex-1 h-7 bg-white/5 border-white/10 rounded-lg text-[11px] text-white px-2"
          />
          <Button
            onClick={handleSubmitCustom}
            disabled={!customInput.trim() || status !== 'ready'}
            className="h-7 px-2 bg-white text-black hover:bg-slate-200 rounded-lg text-[10px]"
            size="sm"
          >
            <Send className="w-2.5 h-2.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  messages,
  status,
  onSendMessage,
  intakeSearch,
  className
}: ChatPanelProps) {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isRunning: isResearching } = useResearchStatus();

  // Filter out research_progress anchor messages and final messages
  const chatMessages = messages.filter(m =>
    m.metadata?.type !== 'research_progress' &&
    m.metadata?.kind !== 'final' &&
    m.metadata?.type !== 'search_batch' &&
    m.metadata?.type !== 'extract_batch' &&
    m.metadata?.type !== 'research_query' &&
    m.metadata?.type !== 'reasoning'
  );

  // Check if there's a pending multi-select
  const hasPendingSelect = (() => {
    const lastAssistantMsg = [...chatMessages].reverse().find(m => m.role === 'assistant');
    return lastAssistantMsg?.metadata?.type === 'multi_choice_select' ||
           lastAssistantMsg?.metadata?.type === 'ask_user';
  })();

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || status !== 'ready' || hasPendingSelect) return;
    onSendMessage(inputMessage.trim());
    setInputMessage('');
  };

  return (
    <div className={cn("h-full flex flex-col bg-[#0a0a0a] border-r border-slate-800/50", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="text-xs font-semibold text-slate-300">Chat</span>
          {isResearching ? (
            <div className="ml-auto flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-[10px] text-blue-400">Researching</span>
            </div>
          ) : status === 'ready' && (
            <div className="ml-auto flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] text-emerald-400">Ready</span>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {chatMessages.map((msg, idx) => {
          const isUser = msg.role === 'user';

          // Ask user / multi-select
          if (msg.metadata?.type === 'ask_user' || msg.metadata?.type === 'multi_choice_select') {
            return (
              <AskUserOptions
                key={idx}
                question={msg.metadata.question || msg.content}
                options={msg.metadata.options || []}
                reason={msg.metadata.reason}
                status={status}
                onSelect={onSendMessage}
              />
            );
          }

          // Intake search result
          if (msg.metadata?.type === 'intake_search') {
            return (
              <div key={idx} className="flex items-start gap-2 animate-in fade-in duration-300">
                <div className="w-5 h-5 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Search className="w-3 h-3 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-[10px] font-medium text-amber-400">Looked up</p>
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  </div>
                  <p className="text-[11px] text-slate-400">{msg.metadata.query}</p>
                </div>
              </div>
            );
          }

          // User message
          if (isUser) {
            return (
              <div key={idx} className="flex justify-end animate-in fade-in slide-in-from-right-2 duration-300">
                <div className="flex items-start gap-2 max-w-[85%]">
                  <div className="px-3 py-2 rounded-2xl rounded-tr-sm bg-white text-black">
                    <p className="text-[12px] font-medium leading-relaxed">{msg.content}</p>
                  </div>
                  <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                    <User className="w-3 h-3 text-slate-500" />
                  </div>
                </div>
              </div>
            );
          }

          // Assistant message
          return (
            <div key={idx} className="flex items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="w-5 h-5 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0 prose prose-invert prose-xs max-w-none">
                <ReactMarkdown
                  components={{
                    p: ({ ...props }) => <p {...props} className="text-[12px] text-slate-300 leading-relaxed mb-2 last:mb-0" />,
                    ul: ({ ...props }) => <ul {...props} className="text-[11px] text-slate-400 space-y-1 mb-2 list-disc list-inside" />,
                    li: ({ ...props }) => <li {...props} className="text-slate-400" />,
                    strong: ({ ...props }) => <strong {...props} className="text-white font-medium" />,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          );
        })}

        {/* Intake Search Indicator */}
        {intakeSearch && (
          <div className="flex items-start gap-2 animate-in fade-in duration-200">
            <div className="w-5 h-5 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Search className={cn("w-3 h-3 text-amber-400", intakeSearch.status === 'searching' && "animate-pulse")} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-medium text-amber-400">
                  {intakeSearch.status === 'searching' ? 'Looking up' : 'Looked up'}
                </p>
                {intakeSearch.status === 'searching' && <Loader2 className="w-2.5 h-2.5 text-amber-400 animate-spin" />}
              </div>
              <p className="text-[11px] text-slate-400">{intakeSearch.query}</p>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {status === 'processing' && !intakeSearch && (
          <div className="flex items-center gap-2 text-slate-500 animate-in fade-in duration-200">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[11px]">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-800/50 shrink-0">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <Input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={
              hasPendingSelect
                ? "Select an option above..."
                : isResearching
                ? "Ask a follow-up..."
                : status === 'processing'
                ? "Thinking..."
                : "Ask anything..."
            }
            disabled={status !== 'ready' || hasPendingSelect}
            className="flex-1 h-9 bg-white/[0.02] border-white/5 rounded-xl text-[12px] text-white placeholder:text-slate-600 focus:border-white/10"
          />
          <Button
            type="submit"
            disabled={!inputMessage.trim() || status !== 'ready' || hasPendingSelect}
            className={cn(
              "h-9 w-9 rounded-xl transition-all",
              inputMessage.trim() && status === 'ready' && !hasPendingSelect
                ? 'bg-white text-black hover:bg-slate-200 active:scale-95'
                : 'bg-white/5 text-slate-600 opacity-30'
            )}
            size="icon"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
