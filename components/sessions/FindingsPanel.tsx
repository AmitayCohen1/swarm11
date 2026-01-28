'use client';

import { cn } from '@/lib/utils';
import { Loader2, CheckCircle, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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

interface FindingsPanelProps {
  findings: Finding[];
  objective: string;
  successCriteria?: string[];
  isRunning: boolean;
  isComplete: boolean;
  finalAnswer?: string;
  className?: string;
}

export default function FindingsPanel({
  findings,
  objective,
  successCriteria,
  isRunning,
  isComplete,
  finalAnswer,
  className
}: FindingsPanelProps) {
  return (
    <div className={cn("h-full flex flex-col bg-[#0a0a0a] border-l border-slate-800/50", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Findings</span>
          </div>
          {isRunning && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-[10px] text-blue-400">Live</span>
            </div>
          )}
          {isComplete && (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] text-emerald-400">Complete</span>
            </div>
          )}
        </div>

        {/* Mini objective display */}
        <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
          {objective}
        </p>
      </div>

      {/* Success Criteria (if any) */}
      {successCriteria && Array.isArray(successCriteria) && successCriteria.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-800/30 bg-slate-900/30">
          <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Success Criteria</p>
          <ul className="space-y-0.5">
            {successCriteria.slice(0, 3).map((c, i) => (
              <li key={i} className="text-[10px] text-slate-500 flex gap-1.5">
                <span className="text-slate-600">•</span>
                <span className="line-clamp-1">{c}</span>
              </li>
            ))}
            {successCriteria.length > 3 && (
              <li className="text-[10px] text-slate-600">+{successCriteria.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Findings List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {findings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            {isRunning ? (
              <>
                <div className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center mb-3">
                  <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
                </div>
                <p className="text-xs text-slate-600">Gathering information...</p>
                <p className="text-[10px] text-slate-700 mt-1">Findings will appear here</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center mb-3">
                  <FileText className="w-5 h-5 text-slate-700" />
                </div>
                <p className="text-xs text-slate-600">No findings yet</p>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {findings.map((f, idx) => (
              <div
                key={f.key}
                className={cn(
                  "pb-4 border-b border-slate-800/30 last:border-0 last:pb-0",
                  "animate-in fade-in slide-in-from-right-2 duration-500"
                )}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                {/* Finding Title */}
                <div className="flex items-start gap-2 mb-2">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                    f.confidence === 'high' && "bg-emerald-500",
                    f.confidence === 'medium' && "bg-amber-500",
                    f.confidence === 'low' && "bg-red-500"
                  )} />
                  <p className="text-sm text-white font-medium leading-snug">{f.title}</p>
                </div>

                {/* Finding Content */}
                <div className="text-xs text-slate-400 leading-relaxed pl-3.5 prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ ...props }) => <p {...props} className="mb-1.5 last:mb-0 text-slate-400" />,
                      ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-0.5 mb-1.5 text-slate-400" />,
                      li: ({ ...props }) => <li {...props} className="text-slate-400" />,
                      strong: ({ ...props }) => <strong {...props} className="text-slate-300 font-medium" />,
                    }}
                  >
                    {f.content.length > 300 ? f.content.substring(0, 300) + '...' : f.content}
                  </ReactMarkdown>
                </div>

                {/* Sources */}
                {f.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 pl-3.5">
                    {f.sources.slice(0, 2).map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-slate-600 hover:text-slate-400 underline underline-offset-2 transition-colors"
                      >
                        {s.title || (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()}
                      </a>
                    ))}
                    {f.sources.length > 2 && (
                      <span className="text-[9px] text-slate-700">+{f.sources.length - 2}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Final Answer (when complete) */}
      {isComplete && finalAnswer && (
        <div className="border-t border-slate-800 bg-slate-900/50 p-4 shrink-0 max-h-[40%] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Summary</span>
          </div>
          <div className="text-xs text-slate-300 leading-relaxed prose prose-invert prose-xs max-w-none">
            <ReactMarkdown
              components={{
                p: ({ ...props }) => <p {...props} className="mb-2 last:mb-0 text-slate-300" />,
                ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1 mb-2" />,
                li: ({ ...props }) => <li {...props} className="text-slate-300" />,
                strong: ({ ...props }) => <strong {...props} className="text-white font-medium" />,
              }}
            >
              {finalAnswer.length > 500 ? finalAnswer.substring(0, 500) + '...' : finalAnswer}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
