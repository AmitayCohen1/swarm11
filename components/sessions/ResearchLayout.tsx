'use client';

import { memo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Zap, FileText, Brain, Loader2, AlertCircle } from 'lucide-react';
import SwarmVisualization from './SwarmVisualization';
import FindingsPanel from './FindingsPanel';
import ChatPanel from './ChatPanel';
import { NodeDetailSheet, ObjectiveDetailSheet } from './NodeDetailSheet';

// Types
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: any;
}

interface ResearchState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
  nodes: Record<string, any>;
  findings?: any[];
  finalAnswer?: string;
  decisions?: any[];
  totalTokens?: number;
}

interface ResearchLayoutProps {
  messages: Message[];
  status: 'idle' | 'initializing' | 'ready' | 'processing' | 'researching' | 'error';
  isResearching: boolean;
  researchDoc: ResearchState | null;
  intakeSearch?: { query: string; answer?: string; status: 'searching' | 'complete' } | null;
  error?: string | null;
  onSendMessage: (message: string) => void;
  showInterruptedBanner?: boolean;
  onContinueResearch?: () => void;
  onDismissInterrupted?: () => void;
}

// Memoized Swarm - only re-renders when researchDoc changes
const MemoizedSwarm = memo(function MemoizedSwarm({
  state,
  onNodeClick,
  onObjectiveClick
}: {
  state: ResearchState;
  onNodeClick: (id: string) => void;
  onObjectiveClick: () => void;
}) {
  return (
    <SwarmVisualization
      state={state}
      onNodeClick={onNodeClick}
      onObjectiveClick={onObjectiveClick}
    />
  );
});

// Memoized Chat - only re-renders when its props change
const MemoizedChat = memo(function MemoizedChat({
  messages,
  status,
  isResearching,
  onSendMessage,
  intakeSearch
}: {
  messages: Message[];
  status: string;
  isResearching: boolean;
  onSendMessage: (msg: string) => void;
  intakeSearch?: { query: string; answer?: string; status: 'searching' | 'complete' } | null;
}) {
  return (
    <ChatPanel
      messages={messages}
      status={status as any}
      isResearching={isResearching}
      onSendMessage={onSendMessage}
      intakeSearch={intakeSearch}
    />
  );
});

// Memoized Findings - only re-renders when its props change
const MemoizedFindings = memo(function MemoizedFindings({
  findings,
  objective,
  successCriteria,
  isRunning,
  isComplete,
  finalAnswer
}: {
  findings: any[];
  objective: string;
  successCriteria?: string[];
  isRunning: boolean;
  isComplete: boolean;
  finalAnswer?: string;
}) {
  return (
    <FindingsPanel
      findings={findings}
      objective={objective}
      successCriteria={successCriteria}
      isRunning={isRunning}
      isComplete={isComplete}
      finalAnswer={finalAnswer}
    />
  );
});

// Collapsed sidebar button
function CollapsedBar({
  side,
  icon: Icon,
  label,
  onExpand
}: {
  side: 'left' | 'right';
  icon: any;
  label: string;
  onExpand: () => void;
}) {
  return (
    <div className={cn(
      "w-12 h-full bg-[#0a0a0a] flex flex-col items-center py-3",
      side === 'left' ? "border-r border-slate-800/50" : "border-l border-slate-800/50"
    )}>
      <button
        onClick={onExpand}
        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
      >
        {side === 'left' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
      <div className="mt-3 flex flex-col items-center gap-1">
        <Icon className="w-3.5 h-3.5 text-slate-600" />
        <span className="text-[9px] text-slate-600 font-medium" style={{ writingMode: 'vertical-rl' }}>{label}</span>
      </div>
    </div>
  );
}

// Loading state for center panel
function LoadingState() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center">
          <Brain className="w-8 h-8 text-slate-600 animate-pulse" />
        </div>
        <div className="text-center">
          <p className="text-sm text-slate-400 font-medium">Initializing research...</p>
          <p className="text-xs text-slate-600 mt-1">Setting up research strategy</p>
        </div>
        <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
      </div>
    </div>
  );
}

// Loading state for findings panel
function FindingsLoading() {
  return (
    <div className="h-full bg-[#0a0a0a] border-l border-slate-800/50 flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Findings</span>
          <Loader2 className="w-3 h-3 text-slate-600 animate-spin ml-auto" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-slate-600">Waiting for findings...</p>
      </div>
    </div>
  );
}

export default function ResearchLayout({
  messages,
  status,
  isResearching,
  researchDoc,
  intakeSearch,
  error,
  onSendMessage,
  showInterruptedBanner,
  onContinueResearch,
  onDismissInterrupted
}: ResearchLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showObjectiveSheet, setShowObjectiveSheet] = useState(false);

  const handleNodeClick = useCallback((id: string) => setSelectedNodeId(id), []);
  const handleObjectiveClick = useCallback(() => setShowObjectiveSheet(true), []);
  const handleCloseNodeSheet = useCallback(() => setSelectedNodeId(null), []);
  const handleCloseObjectiveSheet = useCallback(() => setShowObjectiveSheet(false), []);

  const selectedNode = selectedNodeId && researchDoc?.nodes ? researchDoc.nodes[selectedNodeId] : null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* LEFT: Chat */}
      {leftCollapsed ? (
        <CollapsedBar side="left" icon={Zap} label="Chat" onExpand={() => setLeftCollapsed(false)} />
      ) : (
        <div className="w-[25%] h-full relative">
          <MemoizedChat
            messages={messages}
            status={status}
            isResearching={isResearching}
            onSendMessage={onSendMessage}
            intakeSearch={intakeSearch}
          />
          <button
            onClick={() => setLeftCollapsed(true)}
            className="absolute top-3 right-3 w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-white transition-colors z-10"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* CENTER: Swarm */}
      <div className="flex-1 h-full relative bg-[#0a0a0a]">
        {researchDoc ? (
          <MemoizedSwarm
            state={researchDoc}
            onNodeClick={handleNodeClick}
            onObjectiveClick={handleObjectiveClick}
          />
        ) : isResearching ? (
          <LoadingState />
        ) : null}

        {/* Interrupted Banner */}
        {showInterruptedBanner && researchDoc && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="max-w-md mx-4 p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white mb-1">Research was interrupted</h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Progress: {Object.values(researchDoc.nodes).filter((n: any) => n.status === 'done').length}/
                    {Object.keys(researchDoc.nodes).length} questions completed
                  </p>
                  <div className="flex gap-2">
                    <button onClick={onContinueResearch} className="px-4 py-2 text-xs font-semibold rounded-lg bg-white text-black hover:bg-slate-200 transition-colors">
                      Continue Research
                    </button>
                    <button onClick={onDismissInterrupted} className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                      Just Chat
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm">
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400 font-medium">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Findings */}
      {rightCollapsed ? (
        <CollapsedBar side="right" icon={FileText} label="Findings" onExpand={() => setRightCollapsed(false)} />
      ) : (
        <div className="w-[35%] h-full relative">
          {researchDoc ? (
            <MemoizedFindings
              findings={researchDoc.findings || []}
              objective={researchDoc.objective}
              successCriteria={researchDoc.successCriteria}
              isRunning={researchDoc.status === 'running'}
              isComplete={researchDoc.status === 'complete'}
              finalAnswer={researchDoc.finalAnswer}
            />
          ) : isResearching ? (
            <FindingsLoading />
          ) : null}
          <button
            onClick={() => setRightCollapsed(true)}
            className="absolute top-3 left-3 w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-white transition-colors z-10"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sheets */}
      <NodeDetailSheet node={selectedNode} isOpen={!!selectedNodeId} onClose={handleCloseNodeSheet} />
      {researchDoc && (
        <ObjectiveDetailSheet state={researchDoc} isOpen={showObjectiveSheet} onClose={handleCloseObjectiveSheet} />
      )}
    </div>
  );
}
