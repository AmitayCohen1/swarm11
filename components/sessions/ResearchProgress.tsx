'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Brain,
  Loader2,
  ExternalLink,
  Search,
  ChevronRight,
  MessageSquare,
  CheckCircle,
  Lightbulb,
} from 'lucide-react';
import BlurText from '@/components/BlurText';
import ShinyText from '@/components/ShinyText';
import ReactMarkdown from 'react-markdown';

// Types matching the new simplified memory model
interface MemoryEntry {
  type: 'search' | 'result' | 'reflect';
  query?: string;
  answer?: string;
  sources?: { url: string; title?: string }[];
  thought?: string;
  delta?: 'progress' | 'no_change' | 'dead_end';
}

interface QuestionDocument {
  answer: string;
  keyFindings: string[];
  sources: { url: string; title: string; contribution: string }[];
  limitations?: string;
}

interface ResearchQuestion {
  id: string;
  researchRound?: number;
  name: string;
  question: string;
  description?: string;
  goal: string;
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;
  memory: MemoryEntry[];
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;
  document?: QuestionDocument;
}

interface BrainDecision {
  id: string;
  timestamp: string;
  action: 'spawn' | 'synthesize';
  questionId?: string;
  reasoning: string;
}

interface BrainDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  researchRound?: number;
  researchReason?: string;
  questions: ResearchQuestion[];
  brainLog: BrainDecision[];
  status: 'running' | 'synthesizing' | 'complete';
  finalAnswer?: string;
}

function isBrainDoc(doc: any): doc is BrainDoc {
  return doc && 'questions' in doc && 'brainLog' in doc;
}

interface ResearchProgressProps {
  doc: any;
  className?: string;
}

/**
 * Research Progress Component
 * Shows vertical timeline with questions grouped by research round
 */
export default function ResearchProgress({ doc: rawDoc, className }: ResearchProgressProps) {
  if (!isBrainDoc(rawDoc)) {
    return null;
  }

  const doc = rawDoc;

  // Group questions by research round
  const questionsByRound = new Map<number, ResearchQuestion[]>();
  doc.questions.forEach(q => {
    const round = q.researchRound || 1;
    if (!questionsByRound.has(round)) {
      questionsByRound.set(round, []);
    }
    questionsByRound.get(round)!.push(q);
  });

  const rounds = Array.from(questionsByRound.keys()).sort((a, b) => a - b);

  // Track active tab per round
  const [activeTabByRound, setActiveTabByRound] = useState<Record<number, string>>({});

  // Initialize active tabs
  useEffect(() => {
    const newActiveTabs: Record<number, string> = {};
    rounds.forEach(round => {
      const questions = questionsByRound.get(round) || [];
      if (questions.length > 0) {
        const existing = activeTabByRound[round];
        if (existing && questions.find(q => q.id === existing)) {
          newActiveTabs[round] = existing;
        } else {
          newActiveTabs[round] = questions[0].id;
        }
      }
    });
    setActiveTabByRound(newActiveTabs);
  }, [doc.questions.length, rounds.length]);

  // Get brain reasoning for transitions between rounds
  // brainLog spawn entries: [0] = round 1 strategy, [1] = round 2 reasoning, [2] = round 3 reasoning, etc.
  const getBrainThinkingAfterRound = (roundNum: number): string | null => {
    const spawnDecisions = doc.brainLog.filter(d =>
      d.action === 'spawn' && d.reasoning && d.reasoning.length > 20
    );

    // After round N, show reasoning for round N+1 (which is at index N in spawn decisions)
    // roundNum is 1-indexed, so after round 1 we want index 1 (the evaluation reasoning)
    if (roundNum < rounds[rounds.length - 1] && spawnDecisions[roundNum]) {
      return spawnDecisions[roundNum].reasoning;
    }
    return null;
  };

  // Render memory entries as a conversation
  const renderMemory = (memory: MemoryEntry[]) => {
    // Group consecutive search+result pairs
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
      } else if (m.type === 'reflect' && groups.length === 0) {
        groups.push({ search: { type: 'search', query: '' }, reflect: m });
      }
    }

    return (
      <div className="space-y-4">
        {/* Search queries - visible, results in accordion */}
        {groups.map((group, i) => (
          <div key={i} className="space-y-2">
            {group.search.query && (
              <Collapsible>
                <div className="flex items-start gap-2">
                  <Search className="w-3 h-3 text-slate-600 mt-1 shrink-0" />
                  <div className="flex-1">
                    <CollapsibleTrigger className="text-left group/search">
                      <span className="text-sm text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
                        {group.search.query}
                      </span>
                      {group.result && (
                        <ChevronRight className="w-3 h-3 text-slate-600 inline ml-2 transition-transform group-data-[state=open]/search:rotate-90" />
                      )}
                    </CollapsibleTrigger>
                    {group.result && (
                      <CollapsibleContent className="mt-2">
                        <p className="text-xs text-slate-500 leading-relaxed pl-1 border-l border-slate-800 ml-0.5">
                          {group.result.answer || 'No findings recorded.'}
                        </p>
                        {group.result.sources && group.result.sources.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2 pl-1 ml-0.5">
                            {group.result.sources.slice(0, 3).map((source, j) => (
                              <a
                                key={j}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                              >
                                {source.url.includes('http') ? new URL(source.url).hostname.replace('www.', '') : source.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </CollapsibleContent>
                    )}
                  </div>
                </div>
              </Collapsible>
            )}

            {/* Reflection - prominent but minimal */}
            {group.reflect && group.reflect.thought && (
              <div className="flex items-start gap-2 mt-3 mb-4">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-200 leading-relaxed">
                  {group.reflect.thought}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("w-full space-y-8", className)}>
      {/* Research Header */}
      <div className="pb-6 border-b border-white/5">
        <BlurText
          text={doc.objective}
          className="text-2xl font-black tracking-tighter text-white mb-3"
          delay={50}
          animateBy="words"
          direction="top"
        />
        {doc.researchReason && (
          <div className="flex items-start gap-4 p-4 rounded-2xl bg-purple-500/[0.03] border border-purple-500/10">
            <Brain className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ node, ...props }) => <p {...props} className="text-sm text-slate-300 leading-relaxed mb-2 last:mb-0 italic" />,
                  ul: ({ node, ...props }) => <ul {...props} className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-2 italic" />,
                  ol: ({ node, ...props }) => <ol {...props} className="text-sm text-slate-300 list-decimal list-inside space-y-1 mb-2 italic" />,
                  li: ({ node, ...props }) => <li {...props} className="text-sm text-slate-300" />,
                  strong: ({ node, ...props }) => <strong {...props} className="text-slate-200 font-semibold" />,
                }}
              >
                {doc.researchReason}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Empty State - Research just started */}
      {rounds.length === 0 && doc.status === 'running' && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse" />
            <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse [animation-delay:150ms]" />
            <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse [animation-delay:300ms]" />
          </div>
          <p className="mt-6 text-sm text-slate-500">Researching...</p>
        </div>
      )}

      {/* Research Rounds */}
      {rounds.map((roundNum, roundIndex) => {
        const questions = questionsByRound.get(roundNum) || [];
        const activeTab = activeTabByRound[roundNum];
        const activeQuestion = questions.find(q => q.id === activeTab);
        const brainThinking = roundIndex < rounds.length - 1 ? getBrainThinkingAfterRound(roundNum) : null;

        return (
          <div key={roundNum} className="space-y-6">
            <div className="p-6 rounded-3xl bg-white/2 border border-white/5 shadow-2xl backdrop-blur-sm">
              {/* Question Selection - Simple underline tabs */}
              {questions.length > 0 && (
                <div className="mb-6 flex gap-6 overflow-x-auto border-b border-white/10">
                  {questions.map((question) => {
                    const isActive = question.id === activeTab;
                    const isDone = question.status === 'done';
                    const isRunning = question.status === 'running';
                    const searchCount = question.memory.filter(m => m.type === 'search').length;

                    return (
                      <button
                        key={question.id}
                        onClick={() => setActiveTabByRound(prev => ({ ...prev, [roundNum]: question.id }))}
                        className={cn(
                          "flex items-center gap-2 pb-3 text-sm whitespace-nowrap transition-colors border-b-2 -mb-[1px]",
                          isActive
                            ? "text-white border-white"
                            : "text-slate-500 border-transparent hover:text-slate-300"
                        )}
                      >
                        <div
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            isDone ? "bg-emerald-500" :
                            isRunning ? "bg-amber-500 animate-pulse" : "bg-slate-600"
                          )}
                        />
                        {question.name}
                        {searchCount > 0 && (
                          <span className="text-xs text-slate-600">
                            {searchCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Active Question Panel */}
              {activeQuestion && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-xl font-bold text-white leading-tight">
                        {activeQuestion.question}
                      </h3>
                      <div className="flex items-center gap-2 shrink-0">
                        {activeQuestion.confidence && (
                          <span className={cn(
                            "px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest",
                            activeQuestion.confidence === 'high'
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : activeQuestion.confidence === 'medium'
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          )}>
                            {activeQuestion.confidence}
                          </span>
                        )}
                        <span className={cn(
                          "px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest",
                          activeQuestion.status === 'done'
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : activeQuestion.status === 'running'
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                        )}>
                          {activeQuestion.status}
                        </span>
                      </div>
                    </div>

                    {activeQuestion.description && (
                      <p className="text-sm text-slate-400 leading-relaxed">
                        {activeQuestion.description}
                      </p>
                    )}

                    {activeQuestion.goal && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                        <CheckCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest block mb-1">Goal</span>
                          <p className="text-sm text-slate-300">{activeQuestion.goal}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/5">
                        <Lightbulb className="w-3 h-3 text-blue-400" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{activeQuestion.cycles}/{activeQuestion.maxCycles} Iterations</span>
                      </div>
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/5">
                        <Search className="w-3 h-3 text-blue-400" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{activeQuestion.memory.filter(m => m.type === 'search').length} Data Points</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/5">
                    {activeQuestion.memory.length === 0 && activeQuestion.status === 'running' ? (
                      <div className="flex flex-col items-center justify-center py-12 space-y-4">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <ShinyText
                          text="Processing Neural Chains..."
                          className="text-xs font-black uppercase tracking-[0.3em]"
                          color="#475569"
                          shineColor="#94a3b8"
                          speed={3}
                        />
                      </div>
                    ) : (
                      renderMemory(activeQuestion.memory)
                    )}

                    {activeQuestion.status === 'done' && (activeQuestion.document || activeQuestion.summary) && (
                      <div className="mt-6 p-5 rounded-2xl bg-emerald-500/[0.03] border border-emerald-500/10 shadow-lg shadow-emerald-500/5">
                        <div className="flex items-center gap-2 mb-3">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          <ShinyText
                            text="Research Complete"
                            className="text-[10px] font-black uppercase tracking-widest"
                            color="#10b981"
                            shineColor="#6ee7b7"
                            speed={4}
                            disabled={false}
                          />
                        </div>

                        {activeQuestion.document?.answer ? (
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown
                              components={{
                                h1: ({ node, ...props }) => <h1 {...props} className="text-lg font-bold text-white mt-4 mb-2" />,
                                h2: ({ node, ...props }) => <h2 {...props} className="text-base font-bold text-white mt-3 mb-2" />,
                                h3: ({ node, ...props }) => <h3 {...props} className="text-sm font-bold text-white mt-2 mb-1" />,
                                p: ({ node, ...props }) => <p {...props} className="text-sm text-slate-200 leading-relaxed mb-3" />,
                                ul: ({ node, ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-3 text-slate-300" />,
                                ol: ({ node, ...props }) => <ol {...props} className="list-decimal list-inside space-y-1 mb-3 text-slate-300" />,
                                li: ({ node, ...props }) => <li {...props} className="text-sm" />,
                                strong: ({ node, ...props }) => <strong {...props} className="font-bold text-white" />,
                                a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" />,
                              }}
                            >
                              {activeQuestion.document.answer}
                            </ReactMarkdown>
                          </div>
                        ) : activeQuestion.summary ? (
                          <p className="text-sm text-slate-200 leading-relaxed">
                            {activeQuestion.summary}
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400 italic">Research completed</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {brainThinking && (
              <div className="flex items-start gap-5 p-6 rounded-3xl bg-purple-500/[0.02] border border-purple-500/10 ml-6 relative">
                <div className="absolute left-[-24px] top-1/2 -translate-y-1/2 w-6 h-[2px] bg-purple-500/20" />
                <Brain className="w-6 h-6 text-purple-400 shrink-0 mt-1" />
                <div className="space-y-1">
                  <ShinyText
                    text="Cognitive Shift"
                    className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 block"
                    color="#a78bfa"
                    shineColor="#c4b5fd"
                    speed={3}
                  />
                  <BlurText
                    text={brainThinking}
                    className="text-sm text-slate-400 italic font-medium leading-relaxed"
                    delay={30}
                    animateBy="words"
                    direction="top"
                    stepDuration={0.2}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Global Status */}
      <div className="flex justify-center py-6">
        {doc.status === 'running' && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Researching...</span>
          </div>
        )}
        {doc.status === 'synthesizing' && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Writing answer...</span>
          </div>
        )}
      </div>
    </div>
  );
}
