'use client';

import { cn } from '@/lib/utils';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

// Animation variants for sections
const sectionVariants: Variants = {
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

// Animation variants for items within sections
const itemVariants: Variants = {
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

// Animation for section title
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

// V4 Document-centric types - Item-based sections
interface SectionItem {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
}

interface Section {
  id: string;
  title: string;
  items: SectionItem[];
}

interface Strategy {
  approach: string;
  rationale: string;
  nextActions: string[];
}

interface ResearchDoc {
  objective: string;
  doneWhen: string;
  sections: Section[];
  strategy: Strategy;
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
        {doc.doneWhen && (
          <p className="text-slate-500 dark:text-slate-400">
            <span className="font-medium">Done when:</span> {doc.doneWhen}
          </p>
        )}
      </div>

      {/* Strategy - subtle callout with animation */}
      {doc.strategy && (
        <motion.div
          key={doc.strategy.approach}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mb-8 pl-4 border-l-2 border-indigo-300 dark:border-indigo-500/50"
        >
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">Strategy</p>
          <p className="text-slate-700 dark:text-slate-300">{doc.strategy.approach}</p>
          {doc.strategy.nextActions.length > 0 && (
            <motion.p
              key={doc.strategy.nextActions[0]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="text-sm text-slate-500 dark:text-slate-400 mt-2"
            >
              → {doc.strategy.nextActions[0]}
            </motion.p>
          )}
        </motion.div>
      )}

      {/* Sections - clean document flow with animations */}
      {doc.sections.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-slate-400 dark:text-slate-500 italic"
        >
          Researching...
        </motion.p>
      ) : (
        <AnimatePresence mode="popLayout">
          {doc.sections.map((section, idx) => (
            <motion.div
              key={section.id}
              layout
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              className="mb-10"
              style={{ willChange: 'transform, opacity, filter' }}
            >
              <motion.h2
                variants={titleVariants}
                className="text-xl font-semibold text-slate-900 dark:text-white mb-4"
              >
                {section.title}
              </motion.h2>

              {/* Items - render each item with staggered animation */}
              {section.items.length === 0 ? (
                <motion.p
                  variants={itemVariants}
                  className="text-slate-400 dark:text-slate-500 italic text-sm"
                >
                  (no items yet)
                </motion.p>
              ) : (
                <motion.ul className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {section.items.map((item, itemIdx) => (
                      <motion.li
                        key={item.id}
                        layout
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
                        className="group"
                        style={{ willChange: 'transform, opacity, filter' }}
                      >
                        <div className="prose prose-slate dark:prose-invert max-w-none">
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => (
                                <p className="text-slate-700 dark:text-slate-300 leading-relaxed mb-0">
                                  {children}
                                </p>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
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
                            {item.content}
                          </ReactMarkdown>
                        </div>
                        {/* Item sources */}
                        {item.sources && item.sources.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            className="flex flex-wrap gap-2 mt-1"
                          >
                            {item.sources.map((source, i) => {
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
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
