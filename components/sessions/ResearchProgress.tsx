'use client';

import { useState, useMemo } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  ReactFlow,
  Node,
  Edge,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ============================================================
// Types (matching backend ResearchState)
// ============================================================

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

interface Decision {
  timestamp: number;
  type: 'spawn' | 'complete' | 'finish';
  reasoning: string;
  nodeIds?: string[];
  tokens?: number;
}

interface FindingSource {
  url: string;
  title?: string;
  nodeId?: string;
  query?: string;
}

interface Finding {
  key: string;
  title: string;
  content: string;
  confidence: 'low' | 'medium' | 'high';
  sources: FindingSource[];
  updatedAt: number;
}

interface ResearchState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
  nodes: Record<string, ResearchNode>;
  findings?: Finding[];
  finalAnswer?: string;
  decisions?: Decision[];
  totalTokens?: number;
}

function isResearchState(doc: any): doc is ResearchState {
  return doc && 'nodes' in doc && typeof doc.nodes === 'object';
}

// ============================================================
// Custom Nodes for ReactFlow
// ============================================================

interface QuestionNodeData {
  node: ResearchNode;
}

function QuestionNode({ data }: { data: QuestionNodeData }) {
  const n = data.node;
  const isDone = n.status === 'done';
  const isRunning = n.status === 'running';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-slate-600 !w-1.5 !h-1.5 !border-0" />
      <div
        className={cn(
          "px-4 py-3 cursor-pointer",
          "border min-w-[200px] max-w-[260px]",
          "bg-slate-900/90 border-slate-700/50",
          isDone && "border-slate-600",
          isRunning && "border-slate-500"
        )}
      >
        {/* Question */}
        <p className="text-[13px] text-slate-200 leading-snug mb-2">
          {n.question.length > 70 ? n.question.substring(0, 70) + '...' : n.question}
        </p>

        {/* Status row */}
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {isDone && <CheckCircle className="w-3 h-3 text-slate-400" />}
          {isRunning && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
          {!isDone && !isRunning && <div className="w-2.5 h-2.5 rounded-full border border-slate-600" />}

          <span>{n.searches?.length || 0} searches</span>

          {isDone && n.confidence && (
            <span className="ml-auto text-slate-500">{n.confidence}</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-600 !w-1.5 !h-1.5 !border-0" />
    </>
  );
}

interface ObjectiveNodeData {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
}

function ObjectiveNode({ data }: { data: ObjectiveNodeData }) {
  return (
    <>
      <div className="px-5 py-4 bg-slate-900 border border-slate-600 max-w-[380px] cursor-pointer hover:border-slate-500 transition-colors">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Objective</p>
        <p className="text-sm text-white leading-snug">
          {data.objective}
        </p>
        {data.successCriteria && Array.isArray(data.successCriteria) && data.successCriteria.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <ul className="text-xs text-slate-400 space-y-1">
              {data.successCriteria.slice(0, 2).map((c, i) => (
                <li key={i} className="truncate">• {c}</li>
              ))}
              {data.successCriteria.length > 2 && (
                <li className="text-slate-600">+{data.successCriteria.length - 2} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500 !w-2 !h-2 !border-0" />
    </>
  );
}

const nodeTypes = {
  question: QuestionNode,
  objective: ObjectiveNode,
};

// ============================================================
// Findings Sidebar Component (40% width)
// ============================================================

interface FindingsSidebarProps {
  findings: Finding[];
  objective: string;
  successCriteria?: string[];
  isRunning: boolean;
  isComplete: boolean;
}

function FindingsSidebar({ findings, objective, successCriteria, isRunning, isComplete }: FindingsSidebarProps) {
  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] border-r border-slate-800">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800">
        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Objective</p>
        <p className="text-sm text-slate-300 leading-snug">{objective}</p>

        {successCriteria && successCriteria.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-800/50">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Success Criteria</p>
            <ul className="space-y-1">
              {successCriteria.map((c, i) => (
                <li key={i} className="text-xs text-slate-500 flex gap-2">
                  <span className="text-slate-600">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Status Banner */}
      {isRunning && (
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
          <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />
          <span className="text-xs text-slate-500">Researching...</span>
        </div>
      )}
      {isComplete && (
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
          <CheckCircle className="w-3 h-3 text-green-600" />
          <span className="text-xs text-slate-400">Research complete</span>
        </div>
      )}

      {/* Findings */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4">
          <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-4">Findings</p>

          {findings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-slate-700">
                {isRunning ? 'Gathering information...' : 'No findings yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {findings.map((f) => (
                <div key={f.key} className="pb-4 border-b border-slate-800/50 last:border-0">
                  <p className="text-sm text-white font-medium mb-2">{f.title}</p>
                  <div className="text-xs text-slate-300 leading-relaxed prose prose-invert prose-xs max-w-none">
                    <ReactMarkdown
                      components={{
                        p: ({ ...props }) => <p {...props} className="mb-2 last:mb-0 text-slate-300" />,
                        ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2" />,
                        li: ({ ...props }) => <li {...props} className="text-slate-300" />,
                        strong: ({ ...props }) => <strong {...props} className="text-white font-medium" />,
                      }}
                    >
                      {f.content}
                    </ReactMarkdown>
                  </div>
                  {f.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {f.sources.slice(0, 3).map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-slate-600 hover:text-slate-400 underline underline-offset-2"
                        >
                          {s.title || new URL(s.url).hostname}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

interface ResearchProgressProps {
  doc: ResearchState | null;
  className?: string;
  fullScreen?: boolean;
}

export default function ResearchProgress({ doc: rawDoc, className, fullScreen = false }: ResearchProgressProps) {
  const state = useMemo((): ResearchState | null => {
    if (!rawDoc || !isResearchState(rawDoc)) return null;
    return rawDoc;
  }, [rawDoc]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showObjective, setShowObjective] = useState(false);

  if (!state) return null;

  const nodes = Object.values(state.nodes);
  const selectedNode = selectedId ? state.nodes[selectedId] : null;

  const doneCount = nodes.filter(n => n.status === 'done').length;
  const totalCount = nodes.length;

  // Build ReactFlow nodes and edges
  const { flowNodes, flowEdges } = useMemo(() => {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    // Objective node
    flowNodes.push({
      id: 'objective',
      type: 'objective',
      position: { x: 0, y: 0 },
      data: {
        objective: state.objective,
        successCriteria: state.successCriteria,
        status: state.status,
      },
    });

    // Calculate tree layout
    const rootNodes = nodes.filter(n => !n.parentId);
    const childrenMap = new Map<string, ResearchNode[]>();

    for (const n of nodes) {
      if (n.parentId) {
        const siblings = childrenMap.get(n.parentId) || [];
        siblings.push(n);
        childrenMap.set(n.parentId, siblings);
      }
    }

    const NODE_WIDTH = 280;
    const NODE_HEIGHT = 140;
    const H_GAP = 50;
    const V_GAP = 80;
    const OBJECTIVE_GAP = 120; // Extra gap below objective node

    const getSubtreeWidth = (n: ResearchNode): number => {
      const children = childrenMap.get(n.id) || [];
      if (children.length === 0) return NODE_WIDTH;
      const childrenWidth = children.reduce((sum, c) => sum + getSubtreeWidth(c), 0);
      return Math.max(NODE_WIDTH, childrenWidth + (children.length - 1) * H_GAP);
    };

    const positionNode = (n: ResearchNode, x: number, y: number) => {
      flowNodes.push({
        id: n.id,
        type: 'question',
        position: { x, y },
        data: { node: n },
      });

      const children = childrenMap.get(n.id) || [];
      if (children.length > 0) {
        const totalWidth = children.reduce((sum, c) => sum + getSubtreeWidth(c), 0) + (children.length - 1) * H_GAP;
        let currentX = x + NODE_WIDTH / 2 - totalWidth / 2;

        for (const child of children) {
          const childWidth = getSubtreeWidth(child);
          const childX = currentX + childWidth / 2 - NODE_WIDTH / 2;
          positionNode(child, childX, y + NODE_HEIGHT + V_GAP);

          flowEdges.push({
            id: `${n.id}-${child.id}`,
            source: n.id,
            target: child.id,
            style: { stroke: '#334155', strokeWidth: 1 },
          });

          currentX += childWidth + H_GAP;
        }
      }
    };

    // Position root nodes
    const totalRootWidth = rootNodes.reduce((sum, n) => sum + getSubtreeWidth(n), 0) + (rootNodes.length - 1) * H_GAP;
    let currentX = -totalRootWidth / 2;

    for (const n of rootNodes) {
      const width = getSubtreeWidth(n);
      const x = currentX + width / 2 - NODE_WIDTH / 2;
      positionNode(n, x, NODE_HEIGHT + OBJECTIVE_GAP);

      flowEdges.push({
        id: `objective-${n.id}`,
        source: 'objective',
        target: n.id,
        style: { stroke: '#334155', strokeWidth: 1 },
      });

      currentX += width + H_GAP;
    }

    // Center objective
    flowNodes[0].position.x = -175;

    return { flowNodes, flowEdges };
  }, [state.objective, state.successCriteria, state.status, JSON.stringify(state.nodes)]);

  // Render search entries
  const renderSearches = (searches: SearchEntry[]) => (
    <div className="space-y-2">
      {searches.map((s, i) => (
        <Collapsible key={i}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-slate-800/50 transition-colors group">
            <ChevronRight className="w-4 h-4 text-slate-500 transition-transform group-data-[state=open]:rotate-90" />
            <span className="text-sm text-slate-300">{s.query}</span>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="ml-6 pl-4 py-3 border-l border-slate-800">
              <div className="text-sm text-slate-500 leading-relaxed">
                <ReactMarkdown
                  components={{
                    p: ({ ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                    ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2" />,
                    li: ({ ...props }) => <li {...props} />,
                    strong: ({ ...props }) => <strong {...props} className="text-slate-400" />,
                  }}
                >
                  {s.result || 'No findings.'}
                </ReactMarkdown>
              </div>

              {s.reflection && (
                <p className="mt-3 text-sm text-slate-600 italic">→ {s.reflection}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );

  // Full-screen mode: split screen - 40% findings, 60% react-flow
  if (fullScreen) {
    return (
      <div className={cn("w-full h-full flex", className)}>
        {/* 40% Findings Sidebar */}
        <div className="w-[40%] h-full">
          <FindingsSidebar
            findings={state.findings || []}
            objective={state.objective}
            successCriteria={state.successCriteria}
            isRunning={state.status === 'running'}
            isComplete={state.status === 'complete'}
          />
        </div>

        {/* 60% ReactFlow */}
        <div className="w-[60%] h-full bg-[#0a0a0a] relative">
          {/* Status indicator */}
          <div className="absolute top-4 right-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-slate-800">
            <span className="text-[11px] text-slate-500">{doneCount}/{totalCount}</span>
            {state.status === 'running' && (
              <Loader2 className="w-3 h-3 text-slate-500 animate-spin" />
            )}
            {state.status === 'complete' && (
              <CheckCircle className="w-3 h-3 text-slate-500" />
            )}
          </div>

          {/* ReactFlow visualization */}
          <div className="absolute inset-0">
            {nodes.length === 0 && state.status === 'running' ? (
              <div className="flex flex-col items-center justify-center h-full">
                {/* Skeleton objective node */}
                <div className="px-5 py-4 rounded-lg bg-slate-900/50 border border-slate-800 max-w-[380px] mb-8">
                  <p className="text-[10px] text-slate-700 uppercase tracking-wider mb-2">Objective</p>
                  <p className="text-sm text-slate-500 leading-snug">{state.objective}</p>
                </div>

                {/* Loading indicator */}
                <div className="flex items-center gap-3 text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Planning research strategy...</span>
                </div>

                {/* Skeleton branches */}
                <div className="mt-8 flex gap-6">
                  {[1, 2].map((i) => (
                    <div key={i} className="w-48 h-16 rounded-lg bg-slate-900/30 border border-slate-800/50 animate-pulse" />
                  ))}
                </div>
              </div>
            ) : (
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                panOnDrag={true}
                zoomOnScroll={true}
                minZoom={0.2}
                maxZoom={1.5}
                onNodeClick={(_, node) => {
                  if (node.id === 'objective') {
                    setShowObjective(true);
                  } else {
                    setSelectedId(node.id);
                  }
                }}
              />
            )}
          </div>
        </div>

        {/* Detail Sheets */}
        <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-800 p-6">
            {selectedNode && (
              <div className="px-2 pt-4">
                <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                    {selectedNode.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{selectedNode.status}</span>
                    {selectedNode.status === 'done' && selectedNode.confidence && (
                      <span>· {selectedNode.confidence} confidence</span>
                    )}
                    {selectedNode.tokens && (
                      <span className="ml-auto text-slate-500">{selectedNode.tokens.toLocaleString()} tokens</span>
                    )}
                  </div>
                  <SheetTitle className="text-xl text-white font-medium leading-relaxed">
                    {selectedNode.question}
                  </SheetTitle>
                  {selectedNode.reason && (
                    <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Why this question?</p>
                      <p className="text-sm text-slate-300 leading-relaxed">{selectedNode.reason}</p>
                    </div>
                  )}
                </SheetHeader>

                <div className="space-y-8">
                  {selectedNode.status === 'done' && selectedNode.answer && (
                    <div>
                      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Answer</h3>
                      <div className="text-sm text-slate-300 leading-relaxed">
                        <ReactMarkdown
                          components={{
                            p: ({ ...props }) => <p {...props} className="mb-3 last:mb-0" />,
                            ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-2 mb-3" />,
                            li: ({ ...props }) => <li {...props} />,
                            strong: ({ ...props }) => <strong {...props} className="text-white" />,
                          }}
                        >
                          {selectedNode.answer}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}

                  {selectedNode.status === 'done' && selectedNode.suggestedFollowups && selectedNode.suggestedFollowups.length > 0 && (
                    <div>
                      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Suggested Follow-ups</h3>
                      <div className="space-y-3">
                        {selectedNode.suggestedFollowups.map((f, i) => (
                          <div key={i} className="pl-3 border-l-2 border-slate-700">
                            <p className="text-sm text-slate-300">{f.question}</p>
                            <p className="text-xs text-slate-500 mt-1">{f.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
                      Web Searches ({selectedNode.searches?.length || 0})
                    </h3>

                    {!selectedNode.searches || selectedNode.searches.length === 0 ? (
                      <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                        {selectedNode.status === 'running' ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            <span>Researching...</span>
                          </>
                        ) : (
                          <span>Waiting to start...</span>
                        )}
                      </div>
                    ) : (
                      renderSearches(selectedNode.searches)
                    )}
                  </div>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        <Sheet open={showObjective} onOpenChange={setShowObjective}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-800 p-6">
            <div className="px-2 pt-4">
              <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Objective</span>
                  <span className="ml-auto text-[10px] text-slate-600">{state.status}</span>
                </div>
                <SheetTitle className="text-lg text-white font-medium leading-relaxed">
                  {state.objective}
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-6">
                {state.successCriteria && Array.isArray(state.successCriteria) && state.successCriteria.length > 0 && (
                  <div>
                    <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Success Criteria</h3>
                    <ul className="space-y-1.5">
                      {state.successCriteria.map((c, i) => (
                        <li key={i} className="text-sm text-slate-400">• {c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Progress</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                      <p className="text-xl font-medium text-white">{nodes.length}</p>
                      <p className="text-[10px] text-slate-600">Questions</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                      <p className="text-xl font-medium text-white">{doneCount}</p>
                      <p className="text-[10px] text-slate-600">Completed</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                      <p className="text-xl font-medium text-white">{nodes.filter(n => n.status === 'running').length}</p>
                      <p className="text-[10px] text-slate-600">Running</p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                      <p className="text-xl font-medium text-white">{(state.totalTokens || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-600">Tokens</p>
                    </div>
                  </div>
                </div>

                {state.decisions && state.decisions.length > 0 && (
                  <div>
                    <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Decisions</h3>
                    <div className="space-y-2">
                      {state.decisions.slice(-5).map((d, i) => (
                        <div key={i} className="py-2 border-b border-slate-800 last:border-0">
                          <div className="flex items-center gap-2 text-[10px] text-slate-600 mb-1">
                            <span>{d.type}</span>
                            <span>{new Date(d.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2">{d.reasoning}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // Non-fullscreen mode (embedded in chat)
  return (
    <div className={cn("w-full", className)}>
      {/* Header */}
      <div className="text-center mb-4">
        <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
          <span>{doneCount}/{totalCount}</span>
          {state.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
        </div>
      </div>

      {/* Tree - full viewport width */}
      <div className="h-[70vh] min-h-[500px] w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] bg-[#0a0a0a] border-y border-slate-800">
        {nodes.length === 0 && state.status === 'running' ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
            <p className="text-xs text-slate-600">Planning...</p>
          </div>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            panOnDrag={true}
            zoomOnScroll={true}
            minZoom={0.3}
            maxZoom={1.5}
            onNodeClick={(_, node) => {
              if (node.id === 'objective') {
                setShowObjective(true);
              } else {
                setSelectedId(node.id);
              }
            }}
          />
        )}
      </div>

      {/* Final Answer */}
      {state.status === 'complete' && state.finalAnswer && (
        <div className="mt-6 p-5 rounded-lg bg-slate-900 border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Summary</p>
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ ...props }) => <p {...props} className="text-slate-300 mb-2 text-sm" />,
                h2: ({ ...props }) => <h2 {...props} className="text-sm font-medium text-white mt-3 mb-2" />,
                ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2 text-slate-400 text-sm" />,
                li: ({ ...props }) => <li {...props} />,
                strong: ({ ...props }) => <strong {...props} className="text-slate-200" />,
              }}
            >
              {state.finalAnswer}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-800 p-6">
          {selectedNode && (
            <div className="px-2 pt-4">
              <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                  {selectedNode.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{selectedNode.status}</span>
                  {selectedNode.status === 'done' && selectedNode.confidence && (
                    <span>· {selectedNode.confidence} confidence</span>
                  )}
                  {selectedNode.tokens && (
                    <span className="ml-auto text-slate-500">{selectedNode.tokens.toLocaleString()} tokens</span>
                  )}
                </div>
                <SheetTitle className="text-xl text-white font-medium leading-relaxed">
                  {selectedNode.question}
                </SheetTitle>
                {selectedNode.reason && (
                  <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Why this question?</p>
                    <p className="text-sm text-slate-300 leading-relaxed">{selectedNode.reason}</p>
                  </div>
                )}
              </SheetHeader>

              <div className="space-y-8">
                {/* Answer */}
                {selectedNode.status === 'done' && selectedNode.answer && (
                  <div>
                    <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Answer</h3>
                    <div className="text-sm text-slate-300 leading-relaxed">
                      <ReactMarkdown
                        components={{
                          p: ({ ...props }) => <p {...props} className="mb-3 last:mb-0" />,
                          ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-2 mb-3" />,
                          li: ({ ...props }) => <li {...props} />,
                          strong: ({ ...props }) => <strong {...props} className="text-white" />,
                        }}
                      >
                        {selectedNode.answer}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Suggested Follow-ups */}
                {selectedNode.status === 'done' && selectedNode.suggestedFollowups && selectedNode.suggestedFollowups.length > 0 && (
                  <div>
                    <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Suggested Follow-ups</h3>
                    <div className="space-y-3">
                      {selectedNode.suggestedFollowups.map((f, i) => (
                        <div key={i} className="pl-3 border-l-2 border-slate-700">
                          <p className="text-sm text-slate-300">{f.question}</p>
                          <p className="text-xs text-slate-500 mt-1">{f.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Searches */}
                <div>
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
                    Web Searches ({selectedNode.searches?.length || 0})
                  </h3>

                  {!selectedNode.searches || selectedNode.searches.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                      {selectedNode.status === 'running' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>Researching...</span>
                        </>
                      ) : (
                        <span>Waiting to start...</span>
                      )}
                    </div>
                  ) : (
                    renderSearches(selectedNode.searches)
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Objective Detail Sheet */}
      <Sheet open={showObjective} onOpenChange={setShowObjective}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-800 p-6">
          <div className="px-2 pt-4">
            <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Objective</span>
                <span className="ml-auto text-[10px] text-slate-600">{state.status}</span>
              </div>
              <SheetTitle className="text-lg text-white font-medium leading-relaxed">
                {state.objective}
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-6">
              {state.successCriteria && Array.isArray(state.successCriteria) && state.successCriteria.length > 0 && (
                <div>
                  <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Success Criteria</h3>
                  <ul className="space-y-1.5">
                    {state.successCriteria.map((c, i) => (
                      <li key={i} className="text-sm text-slate-400">• {c}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Progress</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                    <p className="text-xl font-medium text-white">{nodes.length}</p>
                    <p className="text-[10px] text-slate-600">Questions</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                    <p className="text-xl font-medium text-white">{doneCount}</p>
                    <p className="text-[10px] text-slate-600">Completed</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                    <p className="text-xl font-medium text-white">{nodes.filter(n => n.status === 'running').length}</p>
                    <p className="text-[10px] text-slate-600">Running</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                    <p className="text-xl font-medium text-white">{(state.totalTokens || 0).toLocaleString()}</p>
                    <p className="text-[10px] text-slate-600">Tokens</p>
                  </div>
                </div>
              </div>

              {state.decisions && state.decisions.length > 0 && (
                <div>
                  <h3 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Decisions</h3>
                  <div className="space-y-2">
                    {state.decisions.slice(-5).map((d, i) => (
                      <div key={i} className="py-2 border-b border-slate-800 last:border-0">
                        <div className="flex items-center gap-2 text-[10px] text-slate-600 mb-1">
                          <span>{d.type}</span>
                          <span>{new Date(d.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2">{d.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
