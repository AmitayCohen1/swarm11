'use client';

import { useState } from 'react';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import ReactMarkdown from 'react-markdown';

export default function OrchestratorChat() {
  const {
    sessionId,
    messages,
    isLoading,
    error,
    creditsUsed,
    userCredits,
    startSession,
    sendMessage,
    stopSession,
    clearError,
  } = useOrchestrator();

  const [inputMessage, setInputMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;

    const message = inputMessage.trim();
    setInputMessage('');

    if (!sessionId) {
      await startSession(message);
    } else {
      await sendMessage(message);
    }
  };

  const handleStop = async () => {
    await stopSession();
    setInputMessage('');
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      {/* Header */}
      <div className="mb-4 p-4 bg-white border rounded-lg shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Orchestrator Agent</h1>
            <p className="text-sm text-gray-600">
              Intelligent agent with research capabilities
            </p>
          </div>
          <div className="text-right">
            {userCredits !== null && (
              <div className="text-sm">
                <span className="font-semibold">Credits:</span> {userCredits}
              </div>
            )}
            {sessionId && (
              <div className="text-xs text-gray-500">Used: {creditsUsed}</div>
            )}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex justify-between items-start">
            <p className="text-red-800">{error}</p>
            <button
              onClick={clearError}
              className="text-red-600 hover:text-red-800"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg mb-2">Start a conversation</p>
            <p className="text-sm">
              Ask me anything - I'll decide whether to research or respond directly!
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-lg ${
              msg.role === 'user'
                ? 'bg-blue-50 ml-8'
                : 'bg-gray-50 mr-8'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                {msg.role === 'user' ? (
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white">
                    U
                  </div>
                ) : (
                  <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white">
                    A
                  </div>
                )}
              </div>

              <div className="flex-1">
                {/* Action Badge */}
                {msg.action && (
                  <div className="mb-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        msg.action === 'research'
                          ? 'bg-purple-100 text-purple-800'
                          : msg.action === 'clarify'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {msg.action === 'research'
                        ? '🔬 Research'
                        : msg.action === 'clarify'
                        ? '❓ Clarifying'
                        : '💬 Direct Response'}
                    </span>
                  </div>
                )}

                {/* Message Content */}
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>

                {/* Research Results */}
                {msg.researchResult && (
                  <div className="mt-4 p-3 bg-white border rounded">
                    <h4 className="font-semibold text-sm mb-2">
                      Research Details
                    </h4>

                    {/* Questions Investigated */}
                    <details className="mb-2">
                      <summary className="cursor-pointer text-sm text-gray-700 hover:text-gray-900">
                        Questions Investigated ({msg.researchResult.questions.length})
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs">
                        {msg.researchResult.questions.map((q: any, i: number) => (
                          <li key={i} className="text-gray-600">
                            • {q.question}
                            <span className="ml-2 text-xs text-gray-400">
                              ({q.priority})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>

                    {/* Key Findings */}
                    {msg.researchResult.structuredResult?.keyFindings && (
                      <details className="mb-2">
                        <summary className="cursor-pointer text-sm text-gray-700 hover:text-gray-900">
                          Key Findings ({msg.researchResult.structuredResult.keyFindings.length})
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs">
                          {msg.researchResult.structuredResult.keyFindings.map(
                            (finding: string, i: number) => (
                              <li key={i} className="text-gray-600">
                                • {finding}
                              </li>
                            )
                          )}
                        </ul>
                      </details>
                    )}

                    {/* Sources */}
                    {msg.researchResult.structuredResult?.sources && (
                      <details>
                        <summary className="cursor-pointer text-sm text-gray-700 hover:text-gray-900">
                          Sources ({msg.researchResult.structuredResult.sources.length})
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs">
                          {msg.researchResult.structuredResult.sources.map(
                            (source: any, i: number) => (
                              <li key={i}>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {source.title}
                                </a>
                              </li>
                            )
                          )}
                        </ul>
                      </details>
                    )}

                    {/* Confidence Level */}
                    {msg.researchResult.structuredResult?.confidenceLevel && (
                      <div className="mt-2 text-xs text-gray-500">
                        Confidence: {msg.researchResult.structuredResult.confidenceLevel}
                      </div>
                    )}
                  </div>
                )}

                <div className="text-xs text-gray-400 mt-2">
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="p-4 bg-gray-50 rounded-lg mr-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white">
                A
              </div>
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="border-t pt-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask me anything..."
            disabled={isLoading}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {sessionId ? 'Send' : 'Start'}
          </button>
          {sessionId && (
            <button
              type="button"
              onClick={handleStop}
              disabled={isLoading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300"
            >
              Stop
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
