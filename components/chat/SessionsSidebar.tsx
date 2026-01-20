'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Plus,
  Trash2,
  Loader2,
  ChevronLeft,
  MoreHorizontal,
  Sparkles
} from 'lucide-react';

interface SessionMeta {
  id: string;
  title: string;
  status: string;
  creditsUsed: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface GroupedSessions {
  today: SessionMeta[];
  yesterday: SessionMeta[];
  lastWeek: SessionMeta[];
  older: SessionMeta[];
}

interface SessionsSidebarProps {
  currentSessionId?: string;
  onNewSession?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SessionsSidebar({
  currentSessionId,
  onNewSession,
  isCollapsed = false,
  onToggleCollapse
}: SessionsSidebarProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/chat/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;

    setDeletingId(sessionId);
    try {
      const response = await fetch(`/api/chat/${sessionId}`, { method: 'DELETE' });
      if (response.ok) {
        setSessions(sessions.filter((s) => s.id !== sessionId));
        if (sessionId === currentSessionId) {
          onNewSession?.();
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const groupSessions = (sessions: SessionMeta[]): GroupedSessions => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    return sessions.reduce(
      (groups, session) => {
        const date = new Date(session.updatedAt);
        if (date >= today) {
          groups.today.push(session);
        } else if (date >= yesterday) {
          groups.yesterday.push(session);
        } else if (date >= lastWeek) {
          groups.lastWeek.push(session);
        } else {
          groups.older.push(session);
        }
        return groups;
      },
      { today: [], yesterday: [], lastWeek: [], older: [] } as GroupedSessions
    );
  };

  const grouped = groupSessions(sessions);

  const SessionItem = ({ session }: { session: SessionMeta }) => {
    const isActive = currentSessionId === session.id;
    const isHovered = hoveredId === session.id;
    const isDeleting = deletingId === session.id;

    return (
      <div
        onClick={() => router.push(`/chat/${session.id}`)}
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
        className={cn(
          "group relative flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg cursor-pointer transition-all duration-200",
          isActive
            ? "bg-white dark:bg-white/10 shadow-sm"
            : "hover:bg-white/60 dark:hover:bg-white/5"
        )}
      >
        {/* Icon */}
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
          isActive
            ? "bg-blue-100 dark:bg-blue-500/20"
            : "bg-slate-100 dark:bg-white/5"
        )}>
          <MessageSquare className={cn(
            "w-4 h-4 transition-colors",
            isActive
              ? "text-blue-600 dark:text-blue-400"
              : "text-slate-400 dark:text-slate-500"
          )} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium truncate transition-colors",
            isActive
              ? "text-slate-900 dark:text-white"
              : "text-slate-700 dark:text-slate-300"
          )}>
            {session.title}
          </p>
        </div>

        {/* Status indicator */}
        {session.status === 'researching' && (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
        )}

        {/* Delete button */}
        <button
          onClick={(e) => handleDelete(session.id, e)}
          disabled={isDeleting}
          className={cn(
            "absolute right-2 p-1.5 rounded-md transition-all",
            "text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10",
            (isHovered || isDeleting) ? "opacity-100" : "opacity-0"
          )}
        >
          {isDeleting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    );
  };

  const SessionGroup = ({ title, sessions }: { title: string; sessions: SessionMeta[] }) => {
    if (sessions.length === 0) return null;

    return (
      <div className="mb-4">
        <p className="px-5 mb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          {title}
        </p>
        <div className="space-y-0.5">
          {sessions.map((session) => (
            <SessionItem key={session.id} session={session} />
          ))}
        </div>
      </div>
    );
  };

  // Collapsed state
  if (isCollapsed) {
    return (
      <div className="w-16 h-full flex flex-col bg-slate-50/80 dark:bg-[#111] border-r border-slate-200/60 dark:border-white/5 transition-all duration-300">
        <div className="p-3 flex flex-col items-center gap-2">
          {/* Logo */}
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-2">
            <Sparkles className="w-5 h-5 text-white" />
          </div>

          {/* New session */}
          <button
            onClick={onNewSession}
            className="w-10 h-10 rounded-xl bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all group"
            title="New Session"
          >
            <Plus className="w-5 h-5 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
          </button>

          {/* Expand */}
          <button
            onClick={onToggleCollapse}
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white dark:hover:bg-white/5 transition-colors"
            title="Expand sidebar"
          >
            <ChevronLeft className="w-5 h-5 text-slate-400 rotate-180" />
          </button>
        </div>

        {/* Mini session list */}
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-2">
          {sessions.slice(0, 8).map((session) => (
            <button
              key={session.id}
              onClick={() => router.push(`/chat/${session.id}`)}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all relative",
                currentSessionId === session.id
                  ? "bg-white dark:bg-white/10 shadow-sm"
                  : "hover:bg-white dark:hover:bg-white/5"
              )}
              title={session.title}
            >
              <MessageSquare className={cn(
                "w-4 h-4",
                currentSessionId === session.id
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-400"
              )} />
              {session.status === 'researching' && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Expanded state
  return (
    <div className="w-72 h-full flex flex-col bg-slate-50/80 dark:bg-[#111] border-r border-slate-200/60 dark:border-white/5 transition-all duration-300">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="font-bold text-slate-900 dark:text-white">Swarm<span className="text-blue-600">10</span></h1>
          <p className="text-xs text-slate-500 dark:text-slate-500">Research Assistant</p>
        </div>
        <button
          onClick={onToggleCollapse}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white dark:hover:bg-white/5 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* New Session Button */}
      <div className="px-4 pb-4">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 font-medium hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-300 transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-slate-300 dark:text-slate-600 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="w-6 h-6 text-slate-300 dark:text-slate-600" />
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-500">No sessions yet</p>
            <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">Start a new session to begin</p>
          </div>
        ) : (
          <>
            <SessionGroup title="Today" sessions={grouped.today} />
            <SessionGroup title="Yesterday" sessions={grouped.yesterday} />
            <SessionGroup title="Last 7 days" sessions={grouped.lastWeek} />
            <SessionGroup title="Older" sessions={grouped.older} />
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-200/60 dark:border-white/5">
        <button
          onClick={() => router.push('/sessions')}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-white dark:hover:bg-white/5 transition-all"
        >
          <MoreHorizontal className="w-4 h-4" />
          View All Sessions
        </button>
      </div>
    </div>
  );
}
