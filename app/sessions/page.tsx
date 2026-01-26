'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { CreditBalance } from '@/components/CreditBalance';
import { 
  Plus, 
  Trash2, 
  Loader2, 
  ChevronRight, 
  Brain, 
  Search,
  Clock,
  Coins,
  FileSearch,
  Activity,
  Telescope
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';

interface SessionMeta {
  id: string;
  title: string;
  status: string;
  creditsUsed: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface GroupedSessions {
  today: SessionMeta[];
  yesterday: SessionMeta[];
  lastWeek: SessionMeta[];
  older: SessionMeta[];
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSessions = useCallback(async (page: number = 1, append: boolean = false) => {
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);

      const response = await fetch(`/api/sessions/list?page=${page}`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();

      if (append) {
        setSessions(prev => [...prev, ...data.sessions]);
      } else {
        setSessions(data.sessions);
      }
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions(1);
  }, [fetchSessions]);

  const loadMore = () => {
    if (pagination && pagination.hasMore && !loadingMore) {
      fetchSessions(pagination.page + 1, true);
    }
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this session?')) return;

    setDeletingId(sessionId);
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      setSessions(sessions.filter((s) => s.id !== sessionId));
      if (pagination) {
        setPagination({ ...pagination, total: pagination.total - 1 });
      }
    } catch (err) {
      alert('Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL sessions? This cannot be undone.')) return;

    setDeletingAll(true);
    try {
      const response = await fetch('/api/sessions/delete-all', { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      setSessions([]);
      if (pagination) {
        setPagination({ ...pagination, total: 0 });
      }
    } catch (err) {
      alert('Failed to delete sessions');
    } finally {
      setDeletingAll(false);
    }
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    return sessions.filter(s => 
      s.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sessions, searchQuery]);

  const groupSessions = (sessions: SessionMeta[]): GroupedSessions => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    return sessions.reduce(
      (groups, session) => {
        const date = new Date(session.updatedAt);
        if (date >= today) groups.today.push(session);
        else if (date >= yesterday) groups.yesterday.push(session);
        else if (date >= lastWeek) groups.lastWeek.push(session);
        else groups.older.push(session);
        return groups;
      },
      { today: [], yesterday: [], lastWeek: [], older: [] } as GroupedSessions
    );
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'researching':
        return { label: 'Researching', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
      case 'active':
        return { label: 'Active', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      default:
        return { label: 'Idle', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' };
    }
  };

  const grouped = groupSessions(filteredSessions);

  const SessionRow = ({ session }: { session: SessionMeta }) => {
    const isDeleting = deletingId === session.id;
    const status = getStatusConfig(session.status);

    return (
      <div
        onClick={() => router.push(`/sessions/${session.id}`)}
        className="group relative flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all cursor-pointer"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-400 group-hover:text-white transition-colors">
          <Telescope className="h-5 w-5" />
        </div>

        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">
              {session.title}
            </h3>
            <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] h-4", status.color)}>
              {status.label}
            </Badge>
          </div>
          
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true })}</span>
            </div>
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>{session.messageCount} steps</span>
            </div>
            <div className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              <span>{session.creditsUsed} credits</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => handleDelete(session.id, e)}
            disabled={isDeleting}
            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
          <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
        </div>
      </div>
    );
  };

  const SessionGroup = ({ title, sessions }: { title: string; sessions: SessionMeta[] }) => {
    if (sessions.length === 0) return null;
    return (
      <div className="mb-8 last:mb-0">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h2>
        <div className="grid gap-2">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black cursor-pointer hover:scale-105 transition-transform"
                onClick={() => router.push('/')}
              >
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white">Research Sessions</h1>
                <p className="text-[10px] text-slate-500">{pagination?.total || 0} sessions found</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <CreditBalance />
              <div className="h-4 w-px bg-white/10" />
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Actions Bar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search research topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-white/5 bg-white/5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-white/20 focus:outline-none focus:ring-0 transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            {sessions.length > 0 && (
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
              >
                {deletingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete All
              </button>
            )}
            <button
              onClick={() => router.push('/sessions/new')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-slate-200 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              New Research
            </button>
          </div>
        </div>

        {/* Content */}
        {loading && !loadingMore ? (
          <div className="grid gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 w-full animate-pulse rounded-xl bg-white/[0.02]" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-full bg-red-500/10 p-3 text-red-500">
              <Activity className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold text-white">Failed to load sessions</h3>
            <p className="mb-6 text-sm text-slate-500">{error}</p>
            <button
              onClick={() => fetchSessions(1)}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium hover:bg-white/5 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
            <div className="mb-4 rounded-full bg-white/5 p-4 text-slate-500">
              <FileSearch className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-semibold text-white">
              {searchQuery ? 'No results found' : 'No research sessions yet'}
            </h3>
            <p className="mb-8 text-sm text-slate-500 max-w-xs">
              {searchQuery 
                ? `We couldn't find any sessions matching "${searchQuery}"`
                : 'Start your first autonomous research session to see it here.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => router.push('/sessions/new')}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-slate-200"
              >
                <Plus className="h-4 w-4" />
                Start Researching
              </button>
            )}
          </div>
        ) : (
          <div className="pb-20">
            <SessionGroup title="Today" sessions={grouped.today} />
            <SessionGroup title="Yesterday" sessions={grouped.yesterday} />
            <SessionGroup title="Last 7 days" sessions={grouped.lastWeek} />
            <SessionGroup title="Older" sessions={grouped.older} />

            {/* Load More */}
            {pagination && pagination.hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-6 py-2 text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-all disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading more...
                    </>
                  ) : (
                    <>Show more sessions</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
