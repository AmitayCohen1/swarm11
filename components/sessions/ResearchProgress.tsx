'use client';

import { useState, useMemo, useCallback } from 'react';
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
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// Types
interface MemoryEntry {
  type: 'search' | 'result' | 'reflect';
  query?: string;
  answer?: string;
  sources?: { url: string; title?: string }[];
  thought?: string;
}

interface ResearchQuestion {
  id: string;
  parentId?: string | null;
  question: string;
  description?: string;
  goal: string;
  status: 'pending' | 'running' | 'done';
  memory: MemoryEntry[];
  confidence: 'low' | 'medium' | 'high' | null;
  document?: {
    answer: string;
    keyFindings: string[];
    sources: { url: string; title: string; contribution: string }[];
  };
  suggestedFollowups?: Array<{ question: string; reason: string }>;
}

interface BrainDoc {
  version: number;
  objective: string;
  successCriteria: string[];
  questions: ResearchQuestion[];
  status: 'running' | 'synthesizing' | 'complete';
  finalAnswer?: string;
}

function isBrainDoc(doc: any): doc is BrainDoc {
  return doc && 'questions' in doc;
}

// Custom node component for research questions
interface QuestionNodeData {
  question: ResearchQuestion;
  onSelect: (id: string) => void;
}

function QuestionNode({ data }: { data: QuestionNodeData }) {
  const q = data.question;
  const isDone = q.status === 'done';
  const isRunning = q.status === 'running';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-slate-600 !w-2 !h-2" />
      <div
        className={cn(
          "px-4 py-3 rounded-xl transition-all cursor-pointer",
          "border min-w-[180px] max-w-[240px]",
          isDone && "bg-slate-800 border-emerald-500/50",
          isRunning && "bg-slate-800 border-amber-500/50",
          !isDone && !isRunning && "bg-slate-800 border-slate-600"
        )}
      >
        {/* Status + confidence row */}
        <div className="flex items-center gap-2 mb-2">
          {isDone && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
          {isRunning && <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />}
          {!isDone && !isRunning && <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-500" />}

          {isDone && q.confidence && (
            <span className={cn(
              "text-[9px] font-medium uppercase",
              q.confidence === 'high' && "text-emerald-400",
              q.confidence === 'medium' && "text-amber-400",
              q.confidence === 'low' && "text-red-400"
            )}>
              {q.confidence}
            </span>
          )}
        </div>

        {/* Question */}
        <p className="text-sm text-white font-medium leading-snug">
          {q.question.length > 50 ? q.question.substring(0, 50) + '...' : q.question}
        </p>

        {/* Search count */}
        <p className="text-[10px] text-slate-500 mt-2">
          {q.memory.filter(m => m.type === 'search').length} searches
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-600 !w-2 !h-2" />
    </>
  );
}

// Objective node (root)
function ObjectiveNode({ data }: { data: { objective: string } }) {
  return (
    <>
      <div className="px-6 py-4 rounded-xl bg-purple-500/20 border border-purple-500/50 max-w-[300px]">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">Objective</span>
        </div>
        <p className="text-sm text-white font-medium leading-snug">
          {data.objective.length > 80 ? data.objective.substring(0, 80) + '...' : data.objective}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-2 !h-2" />
    </>
  );
}

const nodeTypes = {
  question: QuestionNode,
  objective: ObjectiveNode,
};

interface ResearchProgressProps {
  doc: any;
  className?: string;
}

export default function ResearchProgress({ doc: rawDoc, className }: ResearchProgressProps) {
  if (!isBrainDoc(rawDoc)) return null;

  const doc = rawDoc;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedQuestion = doc.questions.find(q => q.id === selectedId);

  const doneCount = doc.questions.filter(q => q.status === 'done').length;
  const totalCount = doc.questions.length;

  // Build nodes and edges for react-flow
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Add objective node at top
    nodes.push({
      id: 'objective',
      type: 'objective',
      position: { x: 0, y: 0 },
      data: { objective: doc.objective },
    });

    // Build tree structure to calculate positions
    const rootQuestions = doc.questions.filter(q => !q.parentId);
    const childrenMap = new Map<string, ResearchQuestion[]>();

    for (const q of doc.questions) {
      if (q.parentId) {
        const siblings = childrenMap.get(q.parentId) || [];
        siblings.push(q);
        childrenMap.set(q.parentId, siblings);
      }
    }

    // Calculate positions using tree layout
    const NODE_WIDTH = 220;
    const NODE_HEIGHT = 120;
    const HORIZONTAL_GAP = 40;
    const VERTICAL_GAP = 80;

    // Get subtree width
    const getSubtreeWidth = (q: ResearchQuestion): number => {
      const children = childrenMap.get(q.id) || [];
      if (children.length === 0) return NODE_WIDTH;
      const childrenWidth = children.reduce((sum, child) => sum + getSubtreeWidth(child), 0);
      return Math.max(NODE_WIDTH, childrenWidth + (children.length - 1) * HORIZONTAL_GAP);
    };

    // Position nodes recursively
    const positionNode = (q: ResearchQuestion, x: number, y: number) => {
      nodes.push({
        id: q.id,
        type: 'question',
        position: { x, y },
        data: { question: q, onSelect: setSelectedId },
      });

      const children = childrenMap.get(q.id) || [];
      if (children.length > 0) {
        const totalWidth = children.reduce((sum, child) => sum + getSubtreeWidth(child), 0) + (children.length - 1) * HORIZONTAL_GAP;
        let currentX = x + NODE_WIDTH / 2 - totalWidth / 2;

        for (const child of children) {
          const childWidth = getSubtreeWidth(child);
          const childX = currentX + childWidth / 2 - NODE_WIDTH / 2;
          positionNode(child, childX, y + NODE_HEIGHT + VERTICAL_GAP);

          edges.push({
            id: `${q.id}-${child.id}`,
            source: q.id,
            target: child.id,
            style: { stroke: '#475569', strokeWidth: 2 },
          });

          currentX += childWidth + HORIZONTAL_GAP;
        }
      }
    };

    // Position root questions
    const totalRootWidth = rootQuestions.reduce((sum, q) => sum + getSubtreeWidth(q), 0) + (rootQuestions.length - 1) * HORIZONTAL_GAP;
    let currentX = -totalRootWidth / 2;

    for (const q of rootQuestions) {
      const width = getSubtreeWidth(q);
      const x = currentX + width / 2 - NODE_WIDTH / 2;
      positionNode(q, x, NODE_HEIGHT + VERTICAL_GAP);

      edges.push({
        id: `objective-${q.id}`,
        source: 'objective',
        target: q.id,
        style: { stroke: '#7c3aed', strokeWidth: 2 },
      });

      currentX += width + HORIZONTAL_GAP;
    }

    // Center objective node
    nodes[0].position.x = -150; // Half of objective node width

    return { initialNodes: nodes, initialEdges: edges };
  }, [doc.questions, doc.objective]);

  // Render memory entries
  const renderMemory = (memory: MemoryEntry[]) => {
    const groups: Array<{ search: MemoryEntry; result?: MemoryEntry; reflect?: MemoryEntry }> = [];

    for (let i = 0; i < memory.length; i++) {
      const m = memory[i];
      if (m.type === 'search') {
        const group: { search: MemoryEntry; result?: MemoryEntry; reflect?: MemoryEntry } = { search: m };
        if (i + 1 < memory.length && memory[i + 1].type === 'result') {
          group.result = memory[i + 1];
          i++;
        }
        if (i + 1 < memory.length && memory[i + 1].type === 'reflect') {
          group.reflect = memory[i + 1];
          i++;
        }
        groups.push(group);
      }
    }

    return (
      <div className="space-y-2">
        {groups.map((group, i) => (
          <Collapsible key={i}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-slate-800/50 transition-colors group">
              <ChevronRight className="w-4 h-4 text-slate-500 transition-transform group-data-[state=open]:rotate-90" />
              <span className="text-sm text-slate-300">{group.search.query}</span>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="ml-6 pl-4 py-3 border-l border-slate-800">
                {group.result && (
                  <div className="text-sm text-slate-500 leading-relaxed">
                    <ReactMarkdown
                      components={{
                        p: ({ ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                        ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2" />,
                        li: ({ ...props }) => <li {...props} />,
                        strong: ({ ...props }) => <strong {...props} className="text-slate-400" />,
                      }}
                    >
                      {group.result.answer || 'No findings.'}
                    </ReactMarkdown>
                  </div>
                )}

                {group.reflect?.thought && (
                  <p className="mt-3 text-sm text-slate-600 italic">→ {group.reflect.thought}</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("w-full", className)}>
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-4 text-sm text-slate-400">
          <span>{doneCount}/{totalCount} complete</span>
          {doc.status === 'running' && (
            <span className="flex items-center gap-1 text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Researching...
            </span>
          )}
        </div>
      </div>

      {/* React Flow Tree */}
      <div className="h-[500px] w-full bg-slate-900/50 rounded-xl border border-slate-800">
        {doc.questions.length === 0 && doc.status === 'running' ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            <p className="text-sm text-slate-400">Planning research...</p>
          </div>
        ) : (
          <ReactFlow
            nodes={initialNodes}
            edges={initialEdges}
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
              if (node.id !== 'objective') {
                setSelectedId(node.id);
              }
            }}
          />
        )}
      </div>

      {/* Final answer */}
      {doc.status === 'complete' && doc.finalAnswer && (
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
              {doc.finalAnswer}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-slate-900 border-slate-800">
          {selectedQuestion && (
            <div className="px-2">
              <SheetHeader className="pb-6 mb-6 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                  {selectedQuestion.status === 'running' && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  <span>{selectedQuestion.status}</span>
                  {selectedQuestion.status === 'done' && selectedQuestion.confidence && (
                    <span>· {selectedQuestion.confidence} confidence</span>
                  )}
                </div>
                <SheetTitle className="text-xl text-white font-medium leading-relaxed">{selectedQuestion.question}</SheetTitle>
                {selectedQuestion.description && (
                  <p className="text-sm text-slate-500 mt-3 leading-relaxed">{selectedQuestion.description}</p>
                )}
              </SheetHeader>

              <div className="space-y-8">
                {/* Final doc */}
                {selectedQuestion.status === 'done' && selectedQuestion.document?.answer && (
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
                        {selectedQuestion.document.answer}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Suggested follow-ups */}
                {selectedQuestion.status === 'done' && selectedQuestion.suggestedFollowups && selectedQuestion.suggestedFollowups.length > 0 && (
                  <div>
                    <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
                      Suggested Follow-ups
                    </h3>
                    <div className="space-y-3">
                      {selectedQuestion.suggestedFollowups.map((followup, i) => (
                        <div key={i} className="pl-3 border-l-2 border-slate-700">
                          <p className="text-sm text-slate-300">{followup.question}</p>
                          <p className="text-xs text-slate-500 mt-1">{followup.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Research journey */}
                <div>
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
                    Web Searches ({selectedQuestion.memory.filter(m => m.type === 'search').length})
                  </h3>

                  {selectedQuestion.memory.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                      {selectedQuestion.status === 'running' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>Researching...</span>
                        </>
                      ) : (
                        <span>Waiting to start...</span>
                      )}
                    </div>
                  ) : (
                    renderMemory(selectedQuestion.memory)
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
