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
} from 'lucide-react';

// Types matching the new simplified memory model
interface MemoryEntry {
  type: 'search' | 'result' | 'reflect';
  query?: string;
  answer?: string;
  sources?: { url: string; title?: string }[];
  thought?: string;
  delta?: 'progress' | 'no_change' | 'dead_end';
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
  researchStrategy?: string;
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
  const getBrainThinkingAfterRound = (roundNum: number): string | null => {
    const decisions = doc.brainLog.filter(d =>
      d.action === 'spawn' && d.reasoning
    );
    if (roundNum < rounds[rounds.length - 1]) {
      const relevantDecision = decisions.find(d => d.reasoning && d.reasoning.length > 20);
      return relevantDecision?.reasoning || null;
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
        // Look for result
        if (i + 1 < memory.length && memory[i + 1].type === 'result') {
          group.result = memory[i + 1];
          i++;
        }
        // Look for reflect
        if (i + 1 < memory.length && memory[i + 1].type === 'reflect') {
          group.reflect = memory[i + 1];
          i++;
        }
        groups.push(group);
      } else if (m.type === 'reflect' && groups.length === 0) {
        // Standalone reflect (like compaction note)
        groups.push({ search: { type: 'search', query: '' }, reflect: m });
      }
    }

    return groups.map((group, i) => (
      <Collapsible key={i} defaultOpen={i === groups.length - 1}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          {group.search.query && (
            <CollapsibleTrigger className="w-full text-left group">
              <div className="flex items-start gap-2">
                <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <Search className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium flex-1">
                  {group.search.query}
                </p>
              </div>
            </CollapsibleTrigger>
          )}

          <CollapsibleContent>
            {group.result && (
              <div className="ml-10 p-3 rounded-lg bg-slate-50 dark:bg-white/3 border border-slate-100 dark:border-white/5">
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {group.result.answer || 'No results'}
                </p>
                {group.result.sources && group.result.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {group.result.sources.slice(0, 5).map((source, j) => {
                      let domain = '';
                      try {
                        domain = new URL(source.url).hostname.replace('www.', '');
                      } catch {
                        domain = source.url;
                      }
                      return (
                        <a
                          key={j}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {domain}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>

          {group.reflect && group.reflect.thought && (
            <div className="ml-10 py-1 flex items-start gap-2">
              <MessageSquare className="w-3 h-3 text-slate-400 mt-1 shrink-0" />
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                {group.reflect.thought}
              </p>
            </div>
          )}
        </motion.div>
      </Collapsible>
    ));
  };

  return (
    <div className={cn("w-full space-y-6", className)}>
      {/* Research Header */}
      <div className="pb-4 border-b border-slate-200 dark:border-white/10">
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {doc.objective}
        </p>
        {doc.researchStrategy && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 italic whitespace-pre-wrap">
            {doc.researchStrategy}
          </p>
        )}
      </div>

      {/* Research Rounds - Vertical Timeline */}
      {rounds.map((roundNum, roundIndex) => {
        const questions = questionsByRound.get(roundNum) || [];
        const activeTab = activeTabByRound[roundNum];
        const activeQuestion = questions.find(q => q.id === activeTab);
        const brainThinking = roundIndex < rounds.length - 1 ? getBrainThinkingAfterRound(roundNum) : null;

        return (
          <div key={roundNum} className="space-y-4">
            {/* Round Questions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-lg bg-white dark:bg-white/3 border border-slate-200/60 dark:border-white/10"
            >
              {/* Round Tabs */}
              {questions.length > 0 && (
                <div className="mb-4">
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
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
                            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border",
                            isActive
                              ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                              : "bg-white dark:bg-white/3 text-slate-700 dark:text-slate-200 border-slate-200/60 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block w-2 h-2 rounded-full",
                              isDone ? "bg-emerald-500" : isRunning ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"
                            )}
                          />
                          <span className="max-w-[200px] truncate">{question.name}</span>
                          {searchCount > 0 && (
                            <span className={cn(
                              "text-xs px-1.5 py-0.5 rounded-full",
                              isActive
                                ? "bg-white/15 text-white/80 dark:bg-black/15 dark:text-black/60"
                                : "bg-slate-100 dark:bg-white/8 text-slate-500 dark:text-slate-400"
                            )}>
                              {searchCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active Question Content */}
              {activeQuestion && (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="pb-3 border-b border-slate-100 dark:border-white/5">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-1">
                      {activeQuestion.question}
                    </h3>
                    {activeQuestion.description && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                        {activeQuestion.description}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Goal: {activeQuestion.goal}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                      <span>{activeQuestion.cycles}/{activeQuestion.maxCycles} cycles</span>
                      <span>{activeQuestion.memory.filter(m => m.type === 'search').length} searches</span>
                    </div>
                  </div>

                  {/* Memory */}
                  <div className="space-y-3">
                    {activeQuestion.memory.length === 0 && activeQuestion.status === 'running' && (
                      <p className="text-sm text-slate-400 italic text-center py-4">
                        Researching...
                      </p>
                    )}

                    {renderMemory(activeQuestion.memory)}

                    {activeQuestion.status === 'done' && activeQuestion.summary && (
                      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                        <p className="text-sm text-emerald-800 dark:text-emerald-300">
                          {activeQuestion.summary}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>

            {/* Brain Thinking between rounds */}
            {brainThinking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 p-4 rounded-lg bg-slate-50 dark:bg-white/2 border border-slate-200/60 dark:border-white/10"
              >
                <Brain className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 dark:text-slate-300 italic">
                  {brainThinking}
                </p>
              </motion.div>
            )}
          </div>
        );
      })}

      {/* Status indicator */}
      {doc.status === 'running' && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Research in progress...</span>
        </div>
      )}
      {doc.status === 'synthesizing' && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Synthesizing final answer...</span>
        </div>
      )}
    </div>
  );
}
