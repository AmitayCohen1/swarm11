'use client';

import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Loader2,
  CheckCircle,
  ChevronRight,
  Globe,
  Search,
  Brain,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface SearchEntry {
  query: string;
  result: string;
  sources?: { url: string; title?: string }[];
  reflection?: string;
  timestamp: number;
}

interface Followup {
  question: string;
  reason: string;
}

interface ResearchNode {
  id: string;
  parentId: string | null;
  question: string;
  reason: string;
  status: 'pending' | 'running' | 'done' | 'pruned';
  answer?: string;
  confidence?: 'low' | 'medium' | 'high';
  suggestedFollowups?: Followup[];
  searches?: SearchEntry[];
  tokens?: number;
}

interface ResearchState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
  nodes: Record<string, ResearchNode>;
  findings?: any[];
  finalAnswer?: string;
  decisions?: { timestamp: number; type: string; reasoning: string }[];
  totalTokens?: number;
}

interface NodeDetailSheetProps {
  node: ResearchNode | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ObjectiveDetailSheetProps {
  state: ResearchState;
  isOpen: boolean;
  onClose: () => void;
}

// Helper to get domain from URL
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function NodeDetailSheet({ node, isOpen, onClose }: NodeDetailSheetProps) {
  if (!node) return null;

  const isDone = node.status === 'done';
  const isRunning = node.status === 'running';

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-[#0a0a0a] border-slate-800 p-0">
        <div className="p-6">
          <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
            {/* Status Row */}
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
              {isRunning && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
              {isDone && <CheckCircle className="w-3 h-3 text-emerald-500" />}
              <span className={cn(
                "font-medium",
                isDone && "text-emerald-400",
                isRunning && "text-blue-400"
              )}>
                {node.status}
              </span>
              {isDone && node.confidence && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    node.confidence === 'high' && "bg-emerald-500/20 text-emerald-400",
                    node.confidence === 'medium' && "bg-amber-500/20 text-amber-400",
                    node.confidence === 'low' && "bg-red-500/20 text-red-400"
                  )}>
                    {node.confidence} confidence
                  </span>
                </>
              )}
              {node.tokens && (
                <span className="ml-auto text-slate-600 font-mono text-[10px]">
                  {node.tokens.toLocaleString()} tokens
                </span>
              )}
            </div>

            {/* Question */}
            <SheetTitle className="text-lg text-white font-medium leading-relaxed text-left">
              {node.question}
            </SheetTitle>

            {/* Reason */}
            {node.reason && (
              <div className="mt-4 p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Why this question?</p>
                <p className="text-sm text-slate-400 leading-relaxed">{node.reason}</p>
              </div>
            )}
          </SheetHeader>

          <div className="space-y-8">
            {/* Answer */}
            {isDone && node.answer && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Brain className="w-3.5 h-3.5" />
                  Answer
                </h3>
                <div className="text-sm text-slate-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ ...props }) => <p {...props} className="mb-3 last:mb-0 text-slate-300" />,
                      ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-2 mb-3" />,
                      li: ({ ...props }) => <li {...props} className="text-slate-300" />,
                      strong: ({ ...props }) => <strong {...props} className="text-white font-medium" />,
                    }}
                  >
                    {node.answer}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Suggested Follow-ups */}
            {isDone && node.suggestedFollowups && node.suggestedFollowups.length > 0 && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">
                  Suggested Follow-ups
                </h3>
                <div className="space-y-2">
                  {node.suggestedFollowups.map((f, i) => (
                    <div key={i} className="pl-3 border-l-2 border-slate-800 py-1">
                      <p className="text-sm text-slate-300">{f.question}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{f.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Searches */}
            <div>
              <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                Web Searches ({node.searches?.length || 0})
              </h3>

              {!node.searches || node.searches.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-slate-600 text-sm">
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span>Researching...</span>
                    </>
                  ) : (
                    <span>No searches yet</span>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {node.searches.map((s, i) => (
                    <Collapsible key={i}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-slate-900/50 transition-colors group">
                        <ChevronRight className="w-4 h-4 text-slate-500 transition-transform group-data-[state=open]:rotate-90" />
                        <span className="text-sm text-slate-300 flex-1">{s.query}</span>
                        {s.sources && s.sources.length > 0 && (
                          <span className="text-[10px] text-slate-600">{s.sources.length} sources</span>
                        )}
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="ml-6 pl-4 py-3 border-l border-slate-800">
                          <div className="text-sm text-slate-400 leading-relaxed prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown
                              components={{
                                p: ({ ...props }) => <p {...props} className="mb-2 last:mb-0 text-slate-400" />,
                                ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2" />,
                                li: ({ ...props }) => <li {...props} className="text-slate-400" />,
                                strong: ({ ...props }) => <strong {...props} className="text-slate-300" />,
                              }}
                            >
                              {s.result || 'No results.'}
                            </ReactMarkdown>
                          </div>

                          {s.reflection && (
                            <p className="mt-3 text-sm text-slate-600 italic border-t border-slate-800 pt-3">
                              → {s.reflection}
                            </p>
                          )}

                          {s.sources && s.sources.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-800">
                              {s.sources.map((src, j) => (
                                <a
                                  key={j}
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md bg-slate-900 text-slate-500 hover:text-white transition-colors"
                                >
                                  <Globe className="w-2.5 h-2.5" />
                                  {src.title || getDomain(src.url)}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ObjectiveDetailSheet({ state, isOpen, onClose }: ObjectiveDetailSheetProps) {
  const nodes = Object.values(state.nodes);
  const doneCount = nodes.filter(n => n.status === 'done').length;
  const runningCount = nodes.filter(n => n.status === 'running').length;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-[#0a0a0a] border-slate-800 p-0">
        <div className="p-6">
          <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Research Objective</span>
              <span className={cn(
                "ml-auto px-2 py-0.5 rounded text-[10px] font-medium",
                state.status === 'running' && "bg-blue-500/20 text-blue-400",
                state.status === 'complete' && "bg-emerald-500/20 text-emerald-400",
                state.status === 'stopped' && "bg-red-500/20 text-red-400"
              )}>
                {state.status}
              </span>
            </div>
            <SheetTitle className="text-lg text-white font-medium leading-relaxed text-left">
              {state.objective}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6">
            {/* Success Criteria */}
            {state.successCriteria && Array.isArray(state.successCriteria) && state.successCriteria.length > 0 && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Success Criteria</h3>
                <ul className="space-y-1.5">
                  {state.successCriteria.map((c, i) => (
                    <li key={i} className="text-sm text-slate-400 flex gap-2">
                      <span className="text-slate-600">•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Progress Stats */}
            <div>
              <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Progress</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-2xl font-semibold text-white">{nodes.length}</p>
                  <p className="text-[10px] text-slate-500">Questions</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-2xl font-semibold text-emerald-400">{doneCount}</p>
                  <p className="text-[10px] text-slate-500">Completed</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-2xl font-semibold text-blue-400">{runningCount}</p>
                  <p className="text-[10px] text-slate-500">Running</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                  <p className="text-2xl font-semibold text-white">{(state.totalTokens || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500">Tokens</p>
                </div>
              </div>
            </div>

            {/* Recent Decisions */}
            {state.decisions && state.decisions.length > 0 && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Recent Decisions</h3>
                <div className="space-y-2">
                  {state.decisions.slice(-5).reverse().map((d, i) => (
                    <div key={i} className="py-2 border-b border-slate-800/50 last:border-0">
                      <div className="flex items-center gap-2 text-[10px] text-slate-600 mb-1">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded font-medium",
                          d.type === 'spawn' && "bg-blue-500/20 text-blue-400",
                          d.type === 'complete' && "bg-emerald-500/20 text-emerald-400",
                          d.type === 'finish' && "bg-purple-500/20 text-purple-400"
                        )}>
                          {d.type}
                        </span>
                        <span>{new Date(d.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{d.reasoning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
