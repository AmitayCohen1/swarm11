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
  Brain,
  ChevronRight,
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
  status: 'pending' | 'running' | 'done';
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

interface ResearchState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
  nodes: Record<string, ResearchNode>;
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
      <Handle type="target" position={Position.Top} className="!bg-slate-600 !w-2 !h-2" />
      <div
        className={cn(
          "px-4 py-3 rounded-xl cursor-pointer transition-all",
          "border min-w-[220px] max-w-[280px]",
          isDone && "bg-slate-800 border-emerald-500/50",
          isRunning && "bg-slate-800 border-amber-500/50",
          !isDone && !isRunning && "bg-slate-800 border-slate-600"
        )}
      >
        {/* Status row */}
        <div className="flex items-center gap-2 mb-2">
          {isDone && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
          {isRunning && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
          {!isDone && !isRunning && <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-500" />}

          {isDone && n.confidence && (
            <span className={cn(
              "text-[9px] font-medium uppercase",
              n.confidence === 'high' && "text-emerald-400",
              n.confidence === 'medium' && "text-amber-400",
              n.confidence === 'low' && "text-red-400"
            )}>
              {n.confidence}
            </span>
          )}

          <span className="text-[10px] text-slate-500 ml-auto">
            {n.searches?.length || 0} searches
          </span>
        </div>

        {/* Question */}
        <p className="text-sm text-white font-medium leading-snug mb-2">
          {n.question.length > 60 ? n.question.substring(0, 60) + '...' : n.question}
        </p>

        {/* Reason - the WHY */}
        {n.reason && (
          <p className="text-[11px] text-slate-400 leading-snug border-t border-slate-700 pt-2 mt-2">
            <span className="text-slate-500">Why:</span> {n.reason.length > 80 ? n.reason.substring(0, 80) + '...' : n.reason}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-600 !w-2 !h-2" />
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
      <div className="px-6 py-4 rounded-xl bg-purple-500/20 border-2 border-purple-500/50 max-w-[400px] cursor-pointer hover:bg-purple-500/30 transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">Research Objective</span>
          <span className="text-[10px] text-purple-400/70 ml-auto">click for details</span>
        </div>
        <p className="text-base text-white font-medium leading-snug mb-3">
          {data.objective}
        </p>
        {data.successCriteria && data.successCriteria.length > 0 && (
          <div className="pt-2 border-t border-purple-500/30">
            <p className="text-[10px] text-purple-300/70 uppercase tracking-wider mb-1">Success Criteria</p>
            <ul className="text-xs text-purple-200/80 space-y-0.5">
              {data.successCriteria.slice(0, 2).map((c, i) => (
                <li key={i} className="truncate">• {c}</li>
              ))}
              {data.successCriteria.length > 2 && (
                <li className="text-purple-400/60">+{data.successCriteria.length - 2} more...</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
    </>
  );
}

const nodeTypes = {
  question: QuestionNode,
  objective: ObjectiveNode,
};

// ============================================================
// Main Component
// ============================================================

interface ResearchProgressProps {
  doc: ResearchState | null;
  className?: string;
}

export default function ResearchProgress({ doc: rawDoc, className }: ResearchProgressProps) {
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
    const V_GAP = 60;

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
            style: { stroke: '#475569', strokeWidth: 2 },
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
      positionNode(n, x, NODE_HEIGHT + V_GAP);

      flowEdges.push({
        id: `objective-${n.id}`,
        source: 'objective',
        target: n.id,
        style: { stroke: '#7c3aed', strokeWidth: 2 },
      });

      currentX += width + H_GAP;
    }

    // Center objective
    flowNodes[0].position.x = -175;

    return { flowNodes, flowEdges };
  }, [state.objective, nodes]);

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

  return (
    <div className={cn("w-full", className)}>
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-4 text-sm text-slate-400">
          <span>{doneCount}/{totalCount} complete</span>
          {state.status === 'running' && (
            <span className="flex items-center gap-1 text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Researching...
            </span>
          )}
        </div>
      </div>

      {/* Tree - full viewport width */}
      <div className="h-[70vh] min-h-[500px] w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] bg-slate-900/50 border-y border-slate-800">
        {nodes.length === 0 && state.status === 'running' ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            <p className="text-sm text-slate-400">Planning research...</p>
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
        <div className="mt-8 p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-bold text-emerald-300 uppercase tracking-wider">Research Complete</span>
          </div>
          <div className="prose prose-invert max-w-none">
            <ReactMarkdown
              components={{
                p: ({ ...props }) => <p {...props} className="text-slate-200 mb-3" />,
                h2: ({ ...props }) => <h2 {...props} className="text-lg font-bold text-white mt-4 mb-2" />,
                ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-3 text-slate-300" />,
                li: ({ ...props }) => <li {...props} />,
                strong: ({ ...props }) => <strong {...props} className="text-white" />,
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
                    <span className="ml-auto text-cyan-400/70">{selectedNode.tokens.toLocaleString()} tokens</span>
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
            <SheetHeader className="pb-6 mb-6 border-b border-purple-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-5 h-5 text-purple-400" />
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">Research Objective</span>
                <span className={cn(
                  "ml-auto text-xs px-2 py-0.5 rounded-full",
                  state.status === 'running' && "bg-amber-500/20 text-amber-400",
                  state.status === 'complete' && "bg-emerald-500/20 text-emerald-400",
                  state.status === 'stopped' && "bg-red-500/20 text-red-400"
                )}>
                  {state.status}
                </span>
              </div>
              <SheetTitle className="text-xl text-white font-medium leading-relaxed">
                {state.objective}
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-8">
              {/* Success Criteria */}
              {state.successCriteria && state.successCriteria.length > 0 && (
                <div>
                  <h3 className="text-xs text-purple-400 uppercase tracking-wider mb-4">Success Criteria</h3>
                  <ul className="space-y-2">
                    {state.successCriteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="text-purple-400 mt-0.5">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Research Stats */}
              <div>
                <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Research Progress</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-2xl font-bold text-white">{nodes.length}</p>
                    <p className="text-xs text-slate-500">Total Questions</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-2xl font-bold text-emerald-400">{doneCount}</p>
                    <p className="text-xs text-slate-500">Completed</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-2xl font-bold text-amber-400">{nodes.filter(n => n.status === 'running').length}</p>
                    <p className="text-xs text-slate-500">Running</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-2xl font-bold text-cyan-400">{(state.totalTokens || 0).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Total Tokens</p>
                  </div>
                </div>
              </div>

              {/* Decision History */}
              {state.decisions && state.decisions.length > 0 && (
                <div>
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Decision History</h3>
                  <div className="space-y-3">
                    {state.decisions.map((d, i) => (
                      <div key={i} className="p-3 rounded-lg bg-slate-800/30 border border-slate-800 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            "text-xs px-1.5 py-0.5 rounded",
                            d.type === 'spawn' && "bg-blue-500/20 text-blue-400",
                            d.type === 'complete' && "bg-emerald-500/20 text-emerald-400",
                            d.type === 'finish' && "bg-purple-500/20 text-purple-400"
                          )}>
                            {d.type}
                          </span>
                          <span className="text-xs text-slate-600">
                            {new Date(d.timestamp).toLocaleTimeString()}
                          </span>
                          {d.tokens && (
                            <span className="text-xs text-cyan-400/70 ml-auto">
                              {d.tokens.toLocaleString()} tokens
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs">{d.reasoning}</p>
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
