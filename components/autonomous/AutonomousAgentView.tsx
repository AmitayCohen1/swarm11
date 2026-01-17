'use client';

import { useState } from 'react';
import { useAutonomousAgent } from '@/hooks/useAutonomousAgent';
import ReactMarkdown from 'react-markdown';

export default function AutonomousAgentView() {
  const {
    status,
    updates,
    currentIteration,
    totalCredits,
    finalReport,
    error,
    stopReason,
    startSession,
    stopSession
  } = useAutonomousAgent();

  const [objective, setObjective] = useState('');
  const [maxQueries, setMaxQueries] = useState(20);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    await startSession(objective, maxQueries);
  };

  const handleReset = () => {
    setObjective('');
    window.location.reload();
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="border-b pb-4">
        <h1 className="text-3xl font-bold">Autonomous Research Agent</h1>
        <p className="text-gray-600 mt-1">
          Give the agent an objective and it will research autonomously until complete
        </p>
      </div>

      {/* Input Form */}
      {status === 'idle' && (
        <form onSubmit={handleStart} className="space-y-4 border rounded-lg p-6 bg-white shadow-sm">
          <div>
            <label className="block font-semibold mb-2 text-lg">Research Objective</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="E.g., Find the top 3 DevRel candidates for a Series A startup, or research the current state of AI agent frameworks..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={4}
              required
            />
          </div>

          <div>
            <label className="block font-semibold mb-2">
              Max Research Iterations: <span className="text-blue-600">{maxQueries}</span>
            </label>
            <input
              type="range"
              min="5"
              max="30"
              step="5"
              value={maxQueries}
              onChange={(e) => setMaxQueries(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-sm text-gray-600 mt-1">
              <span>Quick (5)</span>
              <span>Balanced (15)</span>
              <span>Deep (30)</span>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              Estimated cost: ~{maxQueries * 100} credits (~${(maxQueries * 100 * 0.01).toFixed(2)})
            </p>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
          >
            Start Autonomous Research
          </button>
        </form>
      )}

      {/* Progress Header */}
      {status !== 'idle' && (
        <div className="border rounded-lg p-4 bg-white shadow-sm flex items-center justify-between">
          <div>
            <div className="font-semibold text-lg">
              {status === 'starting' && '⏳ Initializing...'}
              {status === 'running' && '🔄 Research in Progress'}
              {status === 'completed' && '✅ Research Complete'}
              {status === 'error' && '❌ Error'}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              Iteration: {currentIteration} | Credits Used: {totalCredits}
              {stopReason && ` | Reason: ${stopReason.replace(/_/g, ' ')}`}
            </div>
          </div>

          {status === 'running' && (
            <button
              onClick={stopSession}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors"
            >
              Stop Research
            </button>
          )}
        </div>
      )}

      {/* Live Updates */}
      {status === 'running' && updates.length > 0 && (
        <div className="border rounded-lg p-6 bg-white shadow-sm space-y-3 max-h-96 overflow-y-auto">
          <h3 className="font-bold text-lg mb-3 sticky top-0 bg-white pb-2">Live Updates</h3>
          {updates.slice(-10).reverse().map((update, idx) => (
            <div key={idx} className="p-3 bg-gray-50 rounded-lg border-l-4 border-blue-500">
              <div className="text-sm font-semibold text-gray-700 mb-1">
                Iteration {update.iteration}
              </div>
              {update.text && (
                <div className="text-sm mt-1 text-gray-800 line-clamp-3">{update.text}</div>
              )}
              {update.toolCalls && update.toolCalls.length > 0 && (
                <div className="text-xs text-gray-600 mt-2 flex flex-wrap gap-2">
                  {update.toolCalls.map((tc, i) => (
                    <span key={i} className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                      {tc.tool}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-2">
                Credits: {update.creditsUsed || 0} | Tokens: {update.tokensUsed || 0}
              </div>
            </div>
          ))}

          {status === 'running' && (
            <div className="flex items-center gap-2 text-sm text-gray-600 justify-center py-2">
              <div className="animate-spin h-4 w-4 border-2 border-gray-600 border-t-transparent rounded-full" />
              <span>Agent is researching...</span>
            </div>
          )}
        </div>
      )}

      {/* Final Report */}
      {finalReport && (
        <div className="border rounded-lg p-6 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Final Research Report</h2>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              New Research
            </button>
          </div>

          <div className="prose prose-lg max-w-none">
            <ReactMarkdown>{finalReport}</ReactMarkdown>
          </div>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg border text-sm">
            <div className="font-semibold mb-2">Session Summary</div>
            <div className="space-y-1 text-gray-700">
              <div>Total Iterations: {currentIteration}</div>
              <div>Total Credits Used: {totalCredits}</div>
              <div>Cost: ${(totalCredits * 0.01).toFixed(2)}</div>
              {stopReason && (
                <div>Stop Reason: {stopReason.replace(/_/g, ' ')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-red-200 rounded-lg p-4 bg-red-50">
          <div className="font-semibold text-red-900 mb-1">Error</div>
          <div className="text-sm text-red-700">{error}</div>
          <button
            onClick={handleReset}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
