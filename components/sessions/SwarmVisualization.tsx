'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  ReactFlow,
  Node,
  Edge,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, CheckCircle } from 'lucide-react';

// Types
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
  decisions?: any[];
  totalTokens?: number;
}

// Custom Node Components
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
          "border min-w-[180px] max-w-[220px]",
          "bg-slate-900/90 border-slate-700/50 rounded-lg",
          "hover:border-slate-500 transition-colors",
          isDone && "border-slate-600",
          isRunning && "border-blue-500/50 shadow-lg shadow-blue-500/10"
        )}
      >
        <p className="text-[12px] text-slate-200 leading-snug mb-2">
          {n.question.length > 60 ? n.question.substring(0, 60) + '...' : n.question}
        </p>

        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          {isDone && <CheckCircle className="w-3 h-3 text-emerald-500" />}
          {isRunning && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
          {!isDone && !isRunning && <div className="w-2.5 h-2.5 rounded-full border border-slate-600" />}

          <span>{n.searches?.length || 0} searches</span>

          {isDone && n.confidence && (
            <span className={cn(
              "ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium",
              n.confidence === 'high' && "bg-emerald-500/20 text-emerald-400",
              n.confidence === 'medium' && "bg-amber-500/20 text-amber-400",
              n.confidence === 'low' && "bg-red-500/20 text-red-400"
            )}>
              {n.confidence}
            </span>
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
      <div className={cn(
        "px-5 py-4 bg-slate-900 border max-w-[320px] cursor-pointer rounded-xl",
        "hover:border-slate-500 transition-colors",
        data.status === 'running' ? "border-blue-500/50" : "border-slate-600"
      )}>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Objective</p>
        <p className="text-sm text-white leading-snug">
          {data.objective.length > 80 ? data.objective.substring(0, 80) + '...' : data.objective}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500 !w-2 !h-2 !border-0" />
    </>
  );
}

const nodeTypes = {
  question: QuestionNode,
  objective: ObjectiveNode,
};

interface SwarmVisualizationProps {
  state: ResearchState;
  onNodeClick?: (nodeId: string) => void;
  onObjectiveClick?: () => void;
  className?: string;
}

export default function SwarmVisualization({
  state,
  onNodeClick,
  onObjectiveClick,
  className
}: SwarmVisualizationProps) {
  const nodes = Object.values(state.nodes);
  const doneCount = nodes.filter(n => n.status === 'done').length;
  const runningCount = nodes.filter(n => n.status === 'running').length;

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

    const NODE_WIDTH = 240;
    const NODE_HEIGHT = 120;
    const H_GAP = 40;
    const V_GAP = 60;
    const OBJECTIVE_GAP = 100;

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
    flowNodes[0].position.x = -160;

    return { flowNodes, flowEdges };
  }, [state.objective, state.successCriteria, state.status, nodes]);

  return (
    <div className={cn("h-full w-full bg-[#0a0a0a] relative", className)}>
      {/* Status indicator */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-3 px-3 py-2 rounded-lg bg-black/60 border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-medium">{doneCount}/{nodes.length}</span>
          {state.status === 'running' && (
            <>
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              {runningCount > 0 && (
                <span className="text-[10px] text-blue-400">{runningCount} active</span>
              )}
            </>
          )}
          {state.status === 'complete' && (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </div>
      </div>

      {/* ReactFlow */}
      {nodes.length === 0 && state.status === 'running' ? (
        <div className="flex flex-col items-center justify-center h-full">
          <div className="px-5 py-4 rounded-xl bg-slate-900/50 border border-slate-800 max-w-[320px] mb-6">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Objective</p>
            <p className="text-sm text-slate-400 leading-snug">{state.objective}</p>
          </div>
          <div className="flex items-center gap-3 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Planning research strategy...</span>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
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
              onObjectiveClick?.();
            } else {
              onNodeClick?.(node.id);
            }
          }}
        />
      )}
    </div>
  );
}
