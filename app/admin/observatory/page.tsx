'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AgentStats {
  id: string;
  name: string;
  description: string;
  criteria?: Array<{ name: string; description: string }>;
  stats: {
    totalCalls: number;
    pendingEval: number;
    avgScore: number | null;
  };
}

interface Evaluation {
  id: string;
  agentName: string;
  callCount: number;
  scores: Record<string, number>;
  reasoning?: Record<string, string>;
  insights: string;
  recommendations: string;
  createdAt: string;
}

interface ObservatoryData {
  agents: AgentStats[];
  recentEvaluations: Evaluation[];
}

// Colors for metrics
const METRIC_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

export default function ObservatoryPage() {
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', description: '' });
  const [createdAgent, setCreatedAgent] = useState<{ id: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [triggeringEval, setTriggeringEval] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dialogAction, setDialogAction] = useState<{ type: 'deleteAgent' | 'resetAgent' | 'deleteMetric'; id: string; metricName?: string } | null>(null);

  const copyInstructions = () => {
    if (!data?.agents || data.agents.length === 0) return;
    const agentList = data.agents.map(a => `| \`${a.id}\` | ${a.name} | ${a.description} |`).join('\n');
    const instructions = `# Observatory Agent Integration\n\n| Agent ID | Name | Description |\n|----------|------|-------------|\n${agentList}\n\n## Usage\n\n\`\`\`typescript\ntrackLlmCall({ agentId: 'ID', model: 'model', input: {}, output: {} });\n\`\`\``;
    navigator.clipboard.writeText(instructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin/observatory');
      if (!res.ok) throw new Error('Failed to fetch');
      setData(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (data?.agents && data.agents.length > 0 && !selectedAgent) {
      setSelectedAgent(data.agents[0].id);
    }
  }, [data, selectedAgent]);

  const triggerEval = async (agentId: string) => {
    setTriggeringEval(agentId);
    try {
      await fetch('/api/admin/observatory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      await fetchData();
    } finally {
      setTriggeringEval(null);
    }
  };

  const createNewAgent = async () => {
    if (!newAgent.name || !newAgent.description) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/observatory/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAgent),
      });
      if (res.ok) {
        const json = await res.json();
        setCreatedAgent({ id: json.agent.id });
        setNewAgent({ name: '', description: '' });
        await fetchData();
        setSelectedAgent(json.agent.id);
        setShowAddForm(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const acceptSuggestedMetric = async (agentId: string, metric: { name: string; description: string }) => {
    const agent = data?.agents.find(a => a.id === agentId);
    const existing = agent?.criteria || [];
    if (existing.some(m => m.name === metric.name)) return; // Already exists
    await fetch('/api/admin/observatory/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, metrics: [...existing, metric] }),
    });
    await fetchData();
  };

  const handleDialogConfirm = async () => {
    if (!dialogAction) return;

    if (dialogAction.type === 'deleteMetric' && dialogAction.metricName) {
      const agent = data?.agents.find(a => a.id === dialogAction.id);
      const existing = agent?.criteria || [];
      const filtered = existing.filter(m => m.name !== dialogAction.metricName);
      await fetch('/api/admin/observatory/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dialogAction.id, metrics: filtered }),
      });
      if (selectedMetric === dialogAction.metricName) setSelectedMetric(null);
    } else if (dialogAction.type === 'deleteAgent') {
      await fetch(`/api/admin/observatory/agents?id=${dialogAction.id}`, {
        method: 'DELETE',
      });
      if (selectedAgent === dialogAction.id) {
        setSelectedAgent(data?.agents.find(a => a.id !== dialogAction.id)?.id || null);
      }
    } else if (dialogAction.type === 'resetAgent') {
      await fetch('/api/admin/observatory/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dialogAction.id, resetData: true }),
      });
    }

    await fetchData();
    setDialogAction(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <span className="text-neutral-600 text-sm">loading...</span>
      </div>
    );
  }

  const agent = selectedAgent ? data?.agents.find(a => a.id === selectedAgent) : null;

  // Filter evaluations by time
  const getTimeFilterDate = () => {
    const now = new Date();
    switch (timeFilter) {
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default: return new Date(0);
    }
  };

  const filterDate = getTimeFilterDate();
  const agentEvals = selectedAgent
    ? data?.recentEvaluations
        .filter(e => e.agentName === selectedAgent && new Date(e.createdAt) >= filterDate)
        .reverse()
    : [];

  // Get all metric names (from agent criteria + any in evaluations)
  const metricNames = agent?.criteria?.map(c => c.name) || [];

  // Also check evaluations for metrics not in criteria
  const evalMetrics = new Set<string>();
  agentEvals?.forEach(ev => {
    Object.keys(ev.scores).forEach(k => {
      if (k !== 'overall') evalMetrics.add(k);
    });
  });
  const allMetrics = [...new Set([...metricNames, ...evalMetrics])];

  const getScoreColor = (score: number) => {
    if (score >= 7) return 'text-emerald-400';
    if (score >= 5) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-300 flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-neutral-800/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-neutral-800/50">
          <h1 className="text-[11px] font-medium tracking-widest uppercase text-neutral-600">Observatory</h1>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {data?.agents.map(a => (
            <button
              key={a.id}
              onClick={() => { setSelectedAgent(a.id); setShowAddForm(false); }}
              className={`w-full text-left px-4 py-2.5 transition-colors ${
                selectedAgent === a.id ? 'bg-neutral-800/50 text-white' : 'hover:bg-neutral-800/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm truncate">{a.name}</span>
                {a.stats.avgScore !== null && (
                  <span className={`text-xs tabular-nums ${getScoreColor(a.stats.avgScore)}`}>
                    {a.stats.avgScore.toFixed(1)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-neutral-800/50 space-y-1">
          <button
            onClick={() => { setShowAddForm(true); setCreatedAgent(null); }}
            className="w-full text-xs text-neutral-500 hover:text-white transition-colors text-left py-1"
          >
            + new agent
          </button>
          {data?.agents && data.agents.length > 0 && (
            <button
              onClick={copyInstructions}
              className="w-full text-xs text-neutral-600 hover:text-neutral-400 transition-colors text-left py-1"
            >
              {copied ? 'copied!' : 'copy instructions'}
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {showAddForm ? (
          <div className="p-8 max-w-md">
            <h2 className="text-sm font-medium mb-6 text-white">New Agent</h2>
            <input
              type="text"
              placeholder="Name"
              value={newAgent.name}
              onChange={e => setNewAgent({ ...newAgent, name: e.target.value })}
              className="w-full bg-transparent border border-neutral-800 rounded px-3 py-2 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600 mb-3"
            />
            <input
              type="text"
              placeholder="Description"
              value={newAgent.description}
              onChange={e => setNewAgent({ ...newAgent, description: e.target.value })}
              className="w-full bg-transparent border border-neutral-800 rounded px-3 py-2 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={createNewAgent}
                disabled={creating || !newAgent.name || !newAgent.description}
                className="text-xs bg-white text-black px-3 py-1.5 rounded disabled:opacity-30"
              >
                {creating ? 'creating...' : 'create'}
              </button>
              <button onClick={() => setShowAddForm(false)} className="text-xs text-neutral-500 hover:text-white">
                cancel
              </button>
            </div>
            {createdAgent && (
              <div className="mt-6 p-3 bg-neutral-900 border border-neutral-800 rounded font-mono text-xs">
                agentId: <span className="text-emerald-400">{createdAgent.id}</span>
              </div>
            )}
          </div>
        ) : agent ? (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
              <div>
                <h2 className="text-lg font-medium text-white">{agent.name}</h2>
                <p className="text-xs text-neutral-500 mt-1">{agent.description}</p>
              </div>
              <div className="flex items-start gap-4">
                {/* Suggestions Alert */}
                {(() => {
                  const latestWithSuggestions = [...(agentEvals || [])].reverse().find(ev => {
                    try {
                      const s = ev.recommendations ? JSON.parse(ev.recommendations) : [];
                      return s.length > 0;
                    } catch { return false; }
                  });
                  if (!latestWithSuggestions) return null;
                  const suggested = JSON.parse(latestWithSuggestions.recommendations) as Array<{ name: string; description: string }>;
                  const existingNames = new Set(agent.criteria?.map(c => c.name) || []);
                  const newSuggestions = suggested.filter(s => !existingNames.has(s.name));
                  if (newSuggestions.length === 0) return null;

                  return (
                    <div className="relative">
                      <button
                        onClick={() => setShowSuggestions(!showSuggestions)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                      >
                        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span className="text-sm text-amber-400 font-medium">{newSuggestions.length} suggestion{newSuggestions.length > 1 ? 's' : ''}</span>
                      </button>

                      {showSuggestions && (
                        <div className="absolute right-0 top-12 w-96 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50">
                          <div className="p-3 border-b border-neutral-800">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-white">Suggested Metrics</span>
                              <button onClick={() => setShowSuggestions(false)} className="text-neutral-500 hover:text-white">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="p-3 max-h-96 overflow-y-auto space-y-3">
                            {newSuggestions.map((s, i) => (
                              <div key={i} className="p-4 rounded-lg bg-neutral-800/50 border border-neutral-700/50">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <span className="text-base font-semibold text-white">{s.name}</span>
                                    <p className="text-sm text-neutral-300 mt-2 leading-relaxed">{s.description}</p>
                                  </div>
                                  <button
                                    onClick={() => acceptSuggestedMetric(agent.id, s)}
                                    className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-sm font-medium"
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <code className="text-[10px] text-neutral-600 font-mono">{agent.id}</code>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 bg-neutral-900 border-neutral-800">
                        <DropdownMenuItem
                          onClick={() => setDialogAction({ type: 'resetAgent', id: agent.id })}
                          className="text-neutral-300 focus:text-white focus:bg-neutral-800 cursor-pointer"
                        >
                          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Reset Data
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-neutral-800" />
                        <DropdownMenuItem
                          onClick={() => setDialogAction({ type: 'deleteAgent', id: agent.id })}
                          className="text-red-400 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
                        >
                          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete Agent
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="text-xs text-neutral-600">
                    {agent.stats.totalCalls} calls · {agent.stats.pendingEval} pending
                    {agent.stats.pendingEval >= 5 && (
                      <button
                        onClick={() => triggerEval(agent.id)}
                        disabled={triggeringEval === agent.id}
                        className="ml-2 text-amber-400 hover:text-amber-300"
                      >
                        {triggeringEval === agent.id ? '...' : 'eval →'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {agentEvals && agentEvals.length > 0 ? (
              <>
                {/* Time Filter */}
                <div className="flex items-center gap-2 mb-6">
                  {(['7d', '30d', '90d', 'all'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTimeFilter(t)}
                      className={`px-3 py-1.5 text-xs rounded transition-colors ${
                        timeFilter === t
                          ? 'bg-neutral-800 text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {t === 'all' ? 'All time' : t === '7d' ? '7 days' : t === '30d' ? '30 days' : '90 days'}
                    </button>
                  ))}
                  <span className="text-xs text-neutral-600 ml-2">
                    {agentEvals.length} evaluation{agentEvals.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Combined Chart - All metrics together */}
                {agentEvals.length >= 2 && (
                  <div className="mb-8">
                    <AllMetricsChart evaluations={agentEvals} metrics={allMetrics} />
                  </div>
                )}

                {/* Metric Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {[...allMetrics, 'overall'].filter((v, i, a) => a.indexOf(v) === i).map(metric => {
                    const scores = agentEvals.map(ev => ev.scores[metric] || 0);
                    const latest = scores[scores.length - 1] || 0;
                    const prev = scores.length > 1 ? scores[scores.length - 2] : latest;
                    const trend = latest - prev;

                    return (
                      <button
                        key={metric}
                        onClick={() => setSelectedMetric(selectedMetric === metric ? null : metric)}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          selectedMetric === metric
                            ? 'bg-neutral-800 border-neutral-600'
                            : 'bg-neutral-900/50 border-neutral-800/50 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <span className="text-sm text-neutral-300 font-medium">{metric}</span>
                          <div className="text-right">
                            <span className={`text-lg font-semibold ${getScoreColor(latest)}`}>{latest}</span>
                            {trend !== 0 && (
                              <span className={`text-xs ml-1 ${trend > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {trend > 0 ? '↑' : '↓'}{Math.abs(trend).toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                        <Sparkline scores={scores} color={metric === 'overall' ? '#ffffff' : METRIC_COLORS[allMetrics.indexOf(metric) % METRIC_COLORS.length]} />
                      </button>
                    );
                  })}
                </div>

                {/* Metric Detail Sheet */}
                <Sheet open={!!selectedMetric} onOpenChange={(open) => !open && setSelectedMetric(null)}>
                  <SheetContent side="right" className="w-full sm:max-w-lg bg-[#0a0a0a] border-neutral-800 overflow-y-auto [&>button]:text-white [&>button]:opacity-100 [&>button]:hover:bg-neutral-800">
                    {selectedMetric && (
                      <>
                        {/* Action buttons - top right */}
                        <div className="absolute top-4 right-12 flex items-center gap-2">
                          {selectedMetric !== 'overall' && agent?.criteria?.some(c => c.name === selectedMetric) && (
                            <button
                              onClick={() => setDialogAction({ type: 'deleteMetric', id: agent.id, metricName: selectedMetric })}
                              className="p-2 rounded-lg bg-neutral-800 text-neutral-400 hover:text-red-400 hover:bg-red-500/20 transition-colors"
                              title="Delete metric"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>

                        <SheetHeader className="pr-20">
                          <SheetTitle className="text-white text-xl">{selectedMetric}</SheetTitle>
                          <SheetDescription className="text-neutral-400">
                            {agent?.criteria?.find(c => c.name === selectedMetric)?.description || 'Performance over time'}
                          </SheetDescription>
                        </SheetHeader>

                        <div className="px-4 pb-6">
                          {/* Current Score */}
                          <div className="flex items-center gap-4 mb-6">
                            <span className={`text-4xl font-bold ${getScoreColor(agentEvals[agentEvals.length - 1]?.scores[selectedMetric] || 0)}`}>
                              {agentEvals[agentEvals.length - 1]?.scores[selectedMetric] || '—'}
                            </span>
                            <span className="text-neutral-500 text-sm">/ 10</span>
                          </div>

                          {/* Chart */}
                          <div className="mb-6">
                            <MetricChart
                              evaluations={agentEvals}
                              metric={selectedMetric}
                              color={selectedMetric === 'overall' ? '#ffffff' : METRIC_COLORS[allMetrics.indexOf(selectedMetric) % METRIC_COLORS.length]}
                            />
                          </div>

                          {/* History */}
                          <div className="space-y-3">
                            <h4 className="text-xs text-neutral-500 uppercase tracking-wider mb-3">History</h4>
                            {[...agentEvals].reverse().slice(0, 10).map(ev => {
                              const reason = ev.reasoning?.[selectedMetric];
                              const score = ev.scores[selectedMetric] || 0;
                              return (
                                <div key={ev.id} className="p-3 bg-neutral-900/50 rounded-lg border border-neutral-800/50">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-neutral-500">
                                      {new Date(ev.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span className={`text-lg font-semibold ${getScoreColor(score)}`}>
                                      {score || '—'}
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden mb-2">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${score * 10}%`,
                                        backgroundColor: selectedMetric === 'overall' ? '#ffffff' : METRIC_COLORS[allMetrics.indexOf(selectedMetric) % METRIC_COLORS.length]
                                      }}
                                    />
                                  </div>
                                  {reason && (
                                    <p className="text-sm text-neutral-300">{reason}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </SheetContent>
                </Sheet>

              </>
            ) : (
              <div className="text-center py-12 text-neutral-600">
                <p className="text-sm">No evaluations yet</p>
                <p className="text-xs mt-1">Track 5 calls to trigger first evaluation</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            Select an agent
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!dialogAction} onOpenChange={(open) => !open && setDialogAction(null)}>
        <AlertDialogContent className="bg-neutral-900 border-neutral-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {dialogAction?.type === 'deleteAgent' && 'Delete Agent'}
              {dialogAction?.type === 'resetAgent' && 'Reset Agent Data'}
              {dialogAction?.type === 'deleteMetric' && 'Delete Metric'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-neutral-400">
              {dialogAction?.type === 'deleteAgent' && (
                <>Are you sure you want to delete this agent? This will remove the agent and all its data permanently.</>
              )}
              {dialogAction?.type === 'resetAgent' && (
                <>Are you sure you want to reset all data for this agent? This will delete all calls and evaluations but keep the agent configuration.</>
              )}
              {dialogAction?.type === 'deleteMetric' && (
                <>Are you sure you want to delete the metric &quot;{dialogAction.metricName}&quot;? Historical scores for this metric will be preserved but it will no longer be tracked.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDialogConfirm}
              className={
                dialogAction?.type === 'deleteAgent' || dialogAction?.type === 'deleteMetric'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }
            >
              {dialogAction?.type === 'deleteAgent' && 'Delete'}
              {dialogAction?.type === 'resetAgent' && 'Reset'}
              {dialogAction?.type === 'deleteMetric' && 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// All Metrics Chart - Combined view of all metrics
function AllMetricsChart({
  evaluations,
  metrics,
}: {
  evaluations: Evaluation[];
  metrics: string[];
}) {
  const width = 800;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 35, left: 35 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const allMetrics = [...metrics.filter(m => m !== 'overall'), 'overall'];
  const xStep = chartWidth / (evaluations.length - 1);
  const yScale = (score: number) => chartHeight - (score / 10) * chartHeight;

  const paths = allMetrics.map((metric, idx) => {
    const color = metric === 'overall' ? '#ffffff' : METRIC_COLORS[idx % METRIC_COLORS.length];
    const points = evaluations.map((ev, i) => ({
      x: i * xStep,
      y: yScale(ev.scores[metric] || 0),
    }));
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return { metric, color, d, points };
  });

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-3">
        {allMetrics.map((metric, i) => (
          <div key={metric} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-1 rounded"
              style={{ backgroundColor: metric === 'overall' ? '#ffffff' : METRIC_COLORS[i % METRIC_COLORS.length] }}
            />
            <span className="text-neutral-500">{metric}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* Grid */}
          {[0, 5, 10].map(score => (
            <g key={score}>
              <line x1={0} y1={yScale(score)} x2={chartWidth} y2={yScale(score)} stroke="#1a1a1a" />
              <text x={-8} y={yScale(score)} fill="#404040" fontSize={10} textAnchor="end" dominantBaseline="middle">
                {score}
              </text>
            </g>
          ))}

          {/* Lines */}
          {paths.map(({ metric, color, d }) => (
            <path key={metric} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
          ))}

          {/* X labels */}
          {evaluations.map((ev, i) => (
            <text key={ev.id} x={i * xStep} y={chartHeight + 18} fill="#525252" fontSize={10} textAnchor="middle">
              {new Date(ev.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// Sparkline Component - Mini chart for metric cards
function Sparkline({ scores, color }: { scores: number[]; color: string }) {
  if (scores.length < 2) {
    return <div className="h-8" />;
  }

  const width = 120;
  const height = 32;
  const padding = 2;

  const xStep = (width - padding * 2) / (scores.length - 1);
  const yScale = (score: number) => height - padding - ((score / 10) * (height - padding * 2));

  const points = scores.map((s, i) => `${padding + i * xStep},${yScale(s)}`).join(' ');

  return (
    <svg width={width} height={height} className="w-full">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
    </svg>
  );
}

// MetricChart Component - Full chart for single metric detail view
function MetricChart({
  evaluations,
  metric,
  color,
}: {
  evaluations: Evaluation[];
  metric: string;
  color: string;
}) {
  if (evaluations.length < 2) return null;

  const width = 600;
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 30, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xStep = chartWidth / (evaluations.length - 1);
  const yScale = (score: number) => chartHeight - (score / 10) * chartHeight;

  const points = evaluations.map((ev, i) => ({
    x: i * xStep,
    y: yScale(ev.scores[metric] || 0),
    score: ev.scores[metric] || 0,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Area fill
  const areaD = `${pathD} L ${points[points.length - 1].x} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <defs>
        <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g transform={`translate(${padding.left}, ${padding.top})`}>
        {/* Grid */}
        {[0, 5, 10].map(score => (
          <g key={score}>
            <line x1={0} y1={yScale(score)} x2={chartWidth} y2={yScale(score)} stroke="#1a1a1a" />
            <text x={-8} y={yScale(score)} fill="#404040" fontSize={10} textAnchor="end" dominantBaseline="middle">
              {score}
            </text>
          </g>
        ))}

        {/* Area */}
        <path d={areaD} fill={`url(#gradient-${metric})`} />

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4} fill={color} stroke="#0a0a0a" strokeWidth={2} />
        ))}

        {/* X labels */}
        {evaluations.map((ev, i) => (
          <text key={ev.id} x={i * xStep} y={chartHeight + 18} fill="#525252" fontSize={10} textAnchor="middle">
            {new Date(ev.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </g>
    </svg>
  );
}
