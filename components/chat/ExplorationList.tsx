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

// V7 Document-centric types - Research Questions with Findings
interface Finding {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
  status?: 'active' | 'disqualified';
  disqualifyReason?: string;
}

interface ResearchQuestion {
  id: string;
  question: string;
  status: 'open' | 'done';
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
  objective: string;
  researchQuestions: ResearchQuestion[];
  strategyLog: StrategyLogEntry[];
}

interface ResearchLogProps {
  doc?: ResearchDoc | null;
  className?: string;
}

/**
 * Research Document - Live updating document view
 */
export default function ResearchLog({
  doc,
  className
}: ResearchLogProps) {

  if (!doc) {
    return null;
  }

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

      {/* Research Questions - main document structure */}
      {doc.researchQuestions.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-slate-400 dark:text-slate-500 italic"
        >
          Researching...
        </motion.p>
      ) : (
        <AnimatePresence mode="popLayout">
          {doc.researchQuestions.map((question) => {
            const isDone = question.status === 'done';
            return (
              <motion.div
                key={question.id}
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
                  className="flex items-center gap-2 mb-4"
                >
                  {/* Status indicator */}
                  <span className={cn(
                    "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs",
                    isDone
                      ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                      : "bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500"
                  )}>
                    {isDone ? '✓' : '○'}
                  </span>
                  <h2 className={cn(
                    "text-xl font-semibold",
                    isDone
                      ? "text-slate-500 dark:text-slate-400"
                      : "text-slate-900 dark:text-white"
                  )}>
                    {question.question}
                  </h2>
                </motion.div>

                {/* Findings */}
                {question.findings.length === 0 ? (
                  <motion.p
                    variants={findingVariants}
                    className="text-slate-400 dark:text-slate-500 italic text-sm ml-7"
                  >
                    (no findings yet)
                  </motion.p>
                ) : (
                  <motion.ul className="space-y-3 ml-7">
                    <AnimatePresence mode="popLayout">
                      {question.findings.map((finding) => {
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
