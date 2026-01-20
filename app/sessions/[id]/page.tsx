'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { CreditBalance } from '@/components/CreditBalance';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sparkles,
  User,
  Globe,
  Brain,
  MessageSquare,
  Check,
  Search,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    type?: string;
    queries?: any[];
    question?: string;
    options?: { label: string }[];
    reason?: string;
    materialChange?: string;
    hypotheses?: string;
    review?: string;
    next?: string;
    thinking?: string;
    [key: string]: any;
  };
}

interface Session {
  id: string;
  messages: Message[];
  brain: string;
  status: string;
  creditsUsed: number;
  createdAt: string;
  updatedAt: string;
}

export default function SessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    fetchSession();
  }, [sessionId]);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/chat/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch session');
      }
      const data = await response.json();
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
      researching: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
      completed: 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-slate-400',
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  const renderMessage = (msg: Message, idx: number) => {
    // Skip research iteration messages
    if (msg.metadata?.type === 'research_iteration') return null;

    const isUser = msg.role === 'user';

    if (isUser) {
      return (
        <div key={idx} className="flex flex-col items-end gap-2">
          <div className="flex items-start gap-3 max-w-[85%]">
            <div className="px-5 py-3 rounded-2xl bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-md">
              <p className="text-base leading-relaxed font-medium">{msg.content}</p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 border border-slate-200 dark:border-white/10">
              <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </div>
          </div>
        </div>
      );
    }

    // Search batch
    if (msg.metadata?.type === 'search_batch') {
      const queries = msg.metadata.queries || [];
      return (
        <div key={idx} className="space-y-3">
          {queries.map((q: any, i: number) => (
            <div
              key={i}
              className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-white/3 border border-slate-200/60 dark:border-white/5"
            >
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-medium text-slate-800 dark:text-slate-100">{q.query}</p>
                {q.purpose && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{q.purpose}</p>
                )}
                {q.answer && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 p-3 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10">
                    {q.answer}
                  </p>
                )}
                {q.sources && q.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.sources.slice(0, 3).map((s: any, si: number) => (
                      <a
                        key={si}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[200px]"
                      >
                        {s.title || new URL(s.url).hostname}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Agent thinking
    if (msg.metadata?.type === 'agent_thinking') {
      return (
        <div key={idx} className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-200/60 dark:border-indigo-500/10 space-y-3">
          {msg.metadata.review && (
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-slate-700 dark:text-slate-200 text-base leading-relaxed">{msg.metadata.review}</p>
            </div>
          )}
          {msg.metadata.next && (
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <ArrowRight className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed italic">{msg.metadata.next}</p>
            </div>
          )}
          {msg.metadata.thinking && !msg.metadata.review && (
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-md bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                <Brain className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              </div>
              <p className="text-slate-700 dark:text-slate-200 text-base leading-relaxed">{msg.metadata.thinking}</p>
            </div>
          )}
        </div>
      );
    }

    // Multi-choice / Ask user (already answered)
    if (msg.metadata?.type === 'ask_user' || msg.metadata?.type === 'multi_choice_select') {
      return (
        <div key={idx} className="space-y-3">
          <div className="flex items-start gap-3 opacity-60">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            </div>
            <div className="space-y-1 pt-1">
              <p className="text-slate-600 dark:text-slate-400 text-base font-medium">{msg.metadata.question || msg.content}</p>
              {msg.metadata.reason && (
                <p className="text-slate-500 dark:text-slate-500 text-sm italic">{msg.metadata.reason}</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Default assistant message
    return (
      <div key={idx} className="flex items-start gap-4">
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
                p: ({ ...props }) => <p {...props} className="text-base leading-relaxed mb-4 last:mb-0" />,
                ul: ({ ...props }) => <ul {...props} className="mb-4 space-y-2 list-none" />,
                ol: ({ ...props }) => <ol {...props} className="mb-4 space-y-2 list-decimal list-inside" />,
                li: ({ ...props }) => (
                  <li className="flex items-start gap-2 text-base">
                    <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    <span {...props} />
                  </li>
                ),
                h1: ({ ...props }) => <h1 {...props} className="text-2xl font-black mb-4 tracking-tight" />,
                h2: ({ ...props }) => <h2 {...props} className="text-xl font-bold mb-3 tracking-tight" />,
                h3: ({ ...props }) => <h3 {...props} className="text-lg font-bold mb-2 tracking-tight" />,
                strong: ({ ...props }) => <strong {...props} className="font-bold text-slate-900 dark:text-white" />,
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
  };

  if (loading) {
    return (
      <div className={cn("min-h-screen", isDarkMode ? 'dark' : '')}>
        <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
          <header className="bg-white dark:bg-black/40 border-b border-gray-200 dark:border-white/5">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => router.push('/sessions')}
                    className="text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-white"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Loading...</h1>
                </div>
              </div>
            </div>
          </header>
          <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className={cn("min-h-screen", isDarkMode ? 'dark' : '')}>
        <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
          <header className="bg-white dark:bg-black/40 border-b border-gray-200 dark:border-white/5">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => router.push('/sessions')}
                    className="text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-white"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Session not found</h1>
                </div>
              </div>
            </div>
          </header>
          <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Session not found'}</p>
              <button
                onClick={() => router.push('/sessions')}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
              >
                Back to sessions
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const messages = (session.messages || []) as Message[];
  const firstUserMessage = messages.find(m => m.role === 'user');
  const title = firstUserMessage?.content?.substring(0, 100) || 'Untitled session';

  return (
    <div className={cn("min-h-screen", isDarkMode ? 'dark' : '')}>
      <div className="h-screen flex flex-col bg-white dark:bg-[#0a0a0a] transition-colors">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-slate-200/60 dark:border-white/5 bg-white/80 dark:bg-black/40 backdrop-blur-md z-30 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/sessions')}
              className="text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-slate-800 dark:text-white truncate max-w-[300px]">
                {title.length > 50 ? title.substring(0, 50) + '...' : title}
              </span>
            </div>
            <span className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
              getStatusBadge(session.status)
            )}>
              {session.status}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {messages.length} messages · {session.creditsUsed} credits
            </div>
            <CreditBalance />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>

        {/* Session info bar */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-white/2 border-b border-slate-200/60 dark:border-white/5 text-sm text-slate-500 dark:text-slate-400 shrink-0">
          <div className="max-w-4xl mx-auto flex items-center gap-6">
            <span>Created: {formatDate(session.createdAt)}</span>
            <span>Updated: {formatDate(session.updatedAt)}</span>
          </div>
        </div>

        {/* Messages */}
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-4xl mx-auto py-10 px-6 space-y-8">
              {messages.map((msg, idx) => renderMessage(msg, idx))}
              <div className="h-4" />
            </div>
          </ScrollArea>
        </main>

        {/* Footer */}
        <footer className="p-4 bg-white dark:bg-[#0a0a0a] border-t border-slate-200/60 dark:border-white/5 shrink-0">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-500">
              Read-only view
            </p>
            <button
              onClick={() => router.push('/chat')}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
            >
              Start New Session
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
