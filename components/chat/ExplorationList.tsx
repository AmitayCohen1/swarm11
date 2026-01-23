'use client';

import { cn } from '@/lib/utils';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

// Animation variants for questions
const questionVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    filter: 'blur(10px)',
    scale: 0.95
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    scale: 1,
    transition: {
      duration: 0.4,
      ease: 'easeOut',
      staggerChildren: 0.08
    }
  }
};

// Animation variants for findings
const findingVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -10,
    filter: 'blur(4px)'
  },
  visible: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.3,
      ease: 'easeOut'
    }
  }
};

// Animation for question title
const titleVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -10
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: 'easeOut'
    }
  }
};

// Shared Finding type
interface Finding {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
  status?: 'active' | 'disqualified';
  disqualifyReason?: string;
}

// Legacy V8 Document types - Research Phases
interface ResearchPhase {
  id: string;
  title: string;
  goal: string;
  status: 'not_started' | 'in_progress' | 'done';
  findings: Finding[];
}

interface StrategyLogEntry {
  id: string;
  timestamp: string;
  approach: string;
  rationale: string;
  nextActions: string[];
}

interface ResearchDoc {
  version?: number;
  objective: string;
  phases: ResearchPhase[];
  strategyLog: StrategyLogEntry[];
}

// New Cortex Document types - Initiatives
interface Initiative {
  id: string;
  // New fields
  angle: string;
  rationale: string;
  question: string;
  // Legacy fields (backwards compatible)
  hypothesis?: string;
  goal?: string;
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;
  findings: Finding[];
  queriesRun: string[];
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;
}

interface CortexDecision {
  id: string;
  timestamp: string;
  action: 'spawn' | 'drill_down' | 'kill' | 'synthesize';
  initiativeId?: string;
  reasoning: string;
}

interface CortexDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  initiatives: Initiative[];
  cortexLog: CortexDecision[];
  status: 'running' | 'synthesizing' | 'complete';
  finalAnswer?: string;
}

// Union type for both document formats
type DocumentType = ResearchDoc | CortexDoc;

interface ResearchLogProps {
  doc?: DocumentType | null;
  className?: string;
}

// Type guards
function isCortexDoc(doc: DocumentType): doc is CortexDoc {
  return 'initiatives' in doc && 'cortexLog' in doc;
}

function isResearchDoc(doc: DocumentType): doc is ResearchDoc {
  return 'phases' in doc && 'strategyLog' in doc;
}

/**
 * Research Document - Live updating document view
 * Supports both legacy ResearchDoc (phases) and new CortexDoc (initiatives)
 */
export default function ResearchLog({
  doc,
  className
}: ResearchLogProps) {

  if (!doc) {
    return null;
  }

  // Render CortexDoc (initiatives-based) - Research Board Layout
  if (isCortexDoc(doc)) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {/* Document Header - Objective */}
        <div className="mb-6 pb-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
            {doc.objective}
          </h1>
          {doc.successCriteria && doc.successCriteria.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {doc.successCriteria.map((criterion, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-1 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-full"
                >
                  {criterion}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Research Board - Kanban Layout */}
        {(!doc.initiatives || doc.initiatives.length === 0) ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex items-center justify-center"
          >
            <p className="text-slate-400 dark:text-slate-500 italic">
              Generating research angles...
            </p>
          </motion.div>
        ) : (
          <div className="flex-1 min-h-0 overflow-x-auto">
            <div className="flex gap-4 h-full pb-4" style={{ minWidth: 'max-content' }}>
              <AnimatePresence mode="popLayout">
                {doc.initiatives.map((initiative) => {
                  const isDone = initiative.status === 'done';
                  const isRunning = initiative.status === 'running';
                  const isPending = initiative.status === 'pending';
                  const activeFindings = initiative.findings.filter(f => f.status !== 'disqualified');
                  // Use new fields with fallback to legacy fields
                  const angle = initiative.angle || initiative.hypothesis || 'Research Angle';
                  const rationale = initiative.rationale || '';
                  const question = initiative.question || initiative.goal || '';

                  return (
                    <motion.div
                      key={initiative.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.3 }}
                      className={cn(
                        "flex flex-col w-80 shrink-0 rounded-xl border overflow-hidden",
                        isDone
                          ? "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30"
                          : isRunning
                            ? "bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800/30"
                            : "bg-slate-50/50 dark:bg-white/5 border-slate-200 dark:border-white/10"
                      )}
                    >
                      {/* Column Header */}
                      <div className={cn(
                        "p-4 border-b",
                        isDone
                          ? "border-green-200 dark:border-green-800/30"
                          : isRunning
                            ? "border-indigo-200 dark:border-indigo-800/30"
                            : "border-slate-200 dark:border-white/10"
                      )}>
                        {/* Status Badge & Angle Title */}
                        <div className="flex items-start gap-2 mb-2">
                          <span className={cn(
                            "shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-medium",
                            isDone
                              ? "bg-green-100 dark:bg-green-800/30 text-green-600 dark:text-green-400"
                              : isRunning
                                ? "bg-indigo-100 dark:bg-indigo-800/30 text-indigo-600 dark:text-indigo-400"
                                : "bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500"
                          )}>
                            {isDone ? '✓' : isRunning ? '◉' : '○'}
                          </span>
                          <h3 className={cn(
                            "font-semibold text-base leading-tight",
                            isDone
                              ? "text-green-800 dark:text-green-300"
                              : isRunning
                                ? "text-indigo-800 dark:text-indigo-300"
                                : "text-slate-700 dark:text-slate-300"
                          )}>
                            {angle}
                          </h3>
                        </div>

                        {/* Rationale - WHY this angle */}
                        {rationale && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 leading-relaxed">
                            <span className="font-medium text-slate-600 dark:text-slate-300">Why: </span>
                            {rationale}
                          </p>
                        )}

                        {/* Research Question */}
                        <p className={cn(
                          "text-sm leading-snug",
                          isDone
                            ? "text-green-700 dark:text-green-400"
                            : isRunning
                              ? "text-indigo-700 dark:text-indigo-400"
                              : "text-slate-600 dark:text-slate-400"
                        )}>
                          {question}
                        </p>

                        {/* Meta info */}
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {activeFindings.length} findings
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">•</span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {initiative.cycles}/{initiative.maxCycles} cycles
                          </span>
                          {isDone && initiative.confidence && (
                            <>
                              <span className="text-slate-300 dark:text-slate-600">•</span>
                              <span className={cn(
                                "text-xs font-medium",
                                initiative.confidence === 'high'
                                  ? "text-green-600 dark:text-green-400"
                                  : initiative.confidence === 'medium'
                                    ? "text-yellow-600 dark:text-yellow-400"
                                    : "text-slate-500 dark:text-slate-400"
                              )}>
                                {initiative.confidence}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Findings List */}
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {initiative.findings.length === 0 ? (
                          <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-4">
                            {isRunning ? 'Researching...' : isPending ? 'Waiting...' : 'No findings'}
                          </p>
                        ) : (
                          <AnimatePresence mode="popLayout">
                            {initiative.findings.map((finding) => {
                              const isDisqualified = finding.status === 'disqualified';
                              return (
                                <motion.div
                                  key={finding.id}
                                  layout
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95 }}
                                  transition={{ duration: 0.2 }}
                                  className={cn(
                                    "p-3 rounded-lg border text-sm",
                                    isDisqualified
                                      ? "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30 opacity-60"
                                      : "bg-white dark:bg-white/5 border-slate-200 dark:border-white/10"
                                  )}
                                >
                                  <div className={cn(
                                    "prose prose-sm prose-slate dark:prose-invert max-w-none",
                                    isDisqualified && "line-through decoration-red-400"
                                  )}>
                                    <ReactMarkdown
                                      components={{
                                        p: ({ children }) => (
                                          <p className={cn(
                                            "leading-relaxed mb-0 text-sm",
                                            isDisqualified
                                              ? "text-red-600 dark:text-red-400"
                                              : "text-slate-700 dark:text-slate-300"
                                          )}>
                                            {children}
                                          </p>
                                        ),
                                        strong: ({ children }) => (
                                          <strong className="font-semibold text-slate-900 dark:text-white">
                                            {children}
                                          </strong>
                                        ),
                                        a: ({ href, children }) => (
                                          <a
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 dark:text-blue-400 hover:underline"
                                          >
                                            {children}
                                          </a>
                                        ),
                                      }}
                                    >
                                      {finding.content}
                                    </ReactMarkdown>
                                  </div>
                                  {/* Disqualify reason */}
                                  {isDisqualified && finding.disqualifyReason && (
                                    <p className="text-xs text-red-500 dark:text-red-400 mt-2">
                                      ✗ {finding.disqualifyReason}
                                    </p>
                                  )}
                                  {/* Sources */}
                                  {!isDisqualified && finding.sources && finding.sources.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {finding.sources.map((source, i) => {
                                        const domain = (() => {
                                          try {
                                            return new URL(source.url).hostname.replace('www.', '');
                                          } catch {
                                            return source.url;
                                          }
                                        })();
                                        return (
                                          <a
                                            key={i}
                                            href={source.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-slate-400 hover:text-blue-500 transition-colors"
                                          >
                                            {domain}
                                          </a>
                                        );
                                      })}
                                    </div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                        )}
                      </div>

                      {/* Summary Footer (when done) */}
                      {isDone && initiative.summary && (
                        <div className="p-3 border-t border-green-200 dark:border-green-800/30 bg-green-100/50 dark:bg-green-900/20">
                          <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">
                            <span className="font-medium">Summary: </span>
                            {initiative.summary}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render legacy ResearchDoc (phases-based)
  if (isResearchDoc(doc)) {
    return (
      <div className={cn("flex flex-col", className)}>
        {/* Document Header - Objective */}
        <div className="mb-10 pb-6 border-b border-slate-200 dark:border-white/10">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            {doc.objective}
          </h1>
        </div>

        {/* Strategy Log - shows thinking evolution */}
        {doc.strategyLog && doc.strategyLog.length > 0 && (
          <div className="mb-8">
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-3">Strategy Log</p>
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {doc.strategyLog.map((entry, idx) => {
                  const isLatest = idx === doc.strategyLog.length - 1;
                  return (
                    <motion.div
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, x: -10, filter: 'blur(4px)' }}
                      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className={cn(
                        "pl-4 border-l-2 py-2",
                        isLatest
                          ? "border-indigo-400 dark:border-indigo-500"
                          : "border-slate-200 dark:border-white/10"
                      )}
                    >
                      <p className={cn(
                        "text-sm",
                        isLatest
                          ? "text-slate-800 dark:text-slate-200"
                          : "text-slate-500 dark:text-slate-400"
                      )}>
                        {entry.approach}
                      </p>
                      {isLatest && entry.nextActions.length > 0 && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.15 }}
                          className="text-xs text-slate-400 dark:text-slate-500 mt-1"
                        >
                          {entry.nextActions[0]}
                        </motion.p>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Research Phases - main document structure */}
        {(!doc.phases || doc.phases.length === 0) ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-slate-400 dark:text-slate-500 italic"
          >
            Researching...
          </motion.p>
        ) : (
          <AnimatePresence mode="popLayout">
            {doc.phases.map((phase) => {
              const isDone = phase.status === 'done';
              const isInProgress = phase.status === 'in_progress';
              return (
                <motion.div
                  key={phase.id}
                  layout
                  variants={questionVariants}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  className="mb-10"
                  style={{ willChange: 'transform, opacity, filter' }}
                >
                  <motion.div
                    variants={titleVariants}
                    className="flex items-center gap-2 mb-2"
                  >
                    {/* Status indicator */}
                    <span className={cn(
                      "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs",
                      isDone
                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                        : isInProgress
                          ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                          : "bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500"
                    )}>
                      {isDone ? '✓' : isInProgress ? '→' : '○'}
                    </span>
                    <h2 className={cn(
                      "text-xl font-semibold",
                      isDone
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-slate-900 dark:text-white"
                    )}>
                      {phase.title}
                    </h2>
                  </motion.div>

                  {/* Phase goal */}
                  <motion.p
                    variants={findingVariants}
                    className="text-sm text-slate-500 dark:text-slate-400 ml-7 mb-4"
                  >
                    {phase.goal}
                  </motion.p>

                  {/* Findings */}
                  {phase.findings.length === 0 ? (
                    <motion.p
                      variants={findingVariants}
                      className="text-slate-400 dark:text-slate-500 italic text-sm ml-7"
                    >
                      {isInProgress ? '(researching...)' : '(not started)'}
                    </motion.p>
                  ) : (
                    <motion.ul className="space-y-3 ml-7">
                      <AnimatePresence mode="popLayout">
                        {phase.findings.map((finding) => {
                          const isDisqualified = finding.status === 'disqualified';
                          return (
                            <motion.li
                              key={finding.id}
                              layout
                              variants={findingVariants}
                              initial="hidden"
                              animate="visible"
                              exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
                              className={cn("group", isDisqualified && "opacity-60")}
                              style={{ willChange: 'transform, opacity, filter' }}
                            >
                              <div className={cn(
                                "prose prose-slate dark:prose-invert max-w-none",
                                isDisqualified && "line-through decoration-red-400"
                              )}>
                                <ReactMarkdown
                                  components={{
                                    p: ({ children }) => (
                                      <p className={cn(
                                        "leading-relaxed mb-0",
                                        isDisqualified
                                          ? "text-slate-400 dark:text-slate-500"
                                          : "text-slate-700 dark:text-slate-300"
                                      )}>
                                        {children}
                                      </p>
                                    ),
                                    strong: ({ children }) => (
                                      <strong className={cn(
                                        "font-semibold",
                                        isDisqualified
                                          ? "text-slate-500 dark:text-slate-400"
                                          : "text-slate-900 dark:text-white"
                                      )}>{children}</strong>
                                    ),
                                    a: ({ href, children }) => (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 dark:text-blue-400 hover:underline"
                                      >
                                        {children}
                                      </a>
                                    ),
                                    code: ({ children }) => (
                                      <code className="px-1.5 py-0.5 bg-slate-100 dark:bg-white/10 rounded text-sm font-mono text-slate-800 dark:text-slate-200">
                                        {children}
                                      </code>
                                    ),
                                  }}
                                >
                                  {finding.content}
                                </ReactMarkdown>
                              </div>
                              {/* Disqualify reason */}
                              {isDisqualified && finding.disqualifyReason && (
                                <motion.p
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="text-xs text-red-500 dark:text-red-400 mt-1"
                                >
                                  {finding.disqualifyReason}
                                </motion.p>
                              )}
                              {/* Finding sources */}
                              {!isDisqualified && finding.sources && finding.sources.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: 0.1 }}
                                  className="flex flex-wrap gap-2 mt-1"
                                >
                                  {finding.sources.map((source, i) => {
                                    const domain = (() => {
                                      try {
                                        return new URL(source.url).hostname.replace('www.', '');
                                      } catch {
                                        return source.url;
                                      }
                                    })();
                                    return (
                                      <a
                                        key={i}
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-slate-400 hover:text-blue-500 transition-colors"
                                      >
                                        {domain}
                                      </a>
                                    );
                                  })}
                                </motion.div>
                              )}
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </motion.ul>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    );
  }

  // Fallback for unknown document type
  return (
    <div className={cn("flex flex-col", className)}>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-slate-400 dark:text-slate-500 italic"
      >
        Loading research document...
      </motion.p>
    </div>
  );
}
