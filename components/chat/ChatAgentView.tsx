'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatAgent } from '@/hooks/useChatAgent';
import ReactMarkdown from 'react-markdown';

export default function ChatAgentView() {
  const {
    status,
    messages,
    error,
    isResearching,
    researchProgress,
    brain,
    sendMessage,
    stopResearch
  } = useChatAgent();

  const [inputMessage, setInputMessage] = useState('');
  const [showBrain, setShowBrain] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || status !== 'ready') return;

    const message = inputMessage.trim();
    setInputMessage('');
    await sendMessage(message);
  };

  return (
    <div className="flex h-screen">
      {/* Main Chat Area */}
      <div className={`flex flex-col ${showBrain ? 'w-2/3' : 'w-full'} transition-all duration-300`}>
        {/* Header */}
        <div className="border-b bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Research Assistant</h1>
              <p className="text-sm text-gray-600 mt-1">
                {status === 'initializing' && '🔄 Initializing...'}
                {status === 'ready' && '✅ Ready'}
                {status === 'processing' && '💭 Thinking...'}
                {status === 'researching' && '🔍 Researching...'}
                {status === 'error' && '❌ Error'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Brain toggle button */}
              <button
                onClick={() => setShowBrain(!showBrain)}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors shadow-md hover:shadow-lg flex items-center gap-2 ${
                  showBrain
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                <span className="text-lg">🧠</span>
                {showBrain ? 'Hide Brain' : 'Show Brain'}
              </button>

              {/* Stop button - visible during research */}
              {isResearching && (
                <button
                  onClick={stopResearch}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors shadow-md hover:shadow-lg flex items-center gap-2"
                >
                  <span className="text-lg">⏹</span>
                  Stop Research
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3xl rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 shadow-sm'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}

              {/* Metadata (for research complete messages) */}
              {msg.metadata && (
                <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600">
                  <div className="flex gap-4">
                    {msg.metadata.iterations && (
                      <span>📊 {msg.metadata.iterations} iterations</span>
                    )}
                    {msg.metadata.creditsUsed && (
                      <span>💳 {msg.metadata.creditsUsed} credits</span>
                    )}
                  </div>
                </div>
              )}

              <div className="text-xs mt-2 opacity-70">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {/* Research in progress indicator */}
        {isResearching && (
          <div className="flex justify-center">
            <div className="max-w-3xl w-full bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center justify-center gap-2 text-sm">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                <span className="text-blue-900">Research in progress...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex justify-center">
            <div className="max-w-3xl w-full bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="font-semibold text-red-900 mb-1">Error</div>
              <div className="text-sm text-red-700">{error}</div>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t bg-white p-4 shadow-lg">
          <form onSubmit={handleSend} className="flex gap-3">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={
                status === 'ready'
                  ? 'Type your message or research request...'
                  : status === 'initializing'
                  ? 'Initializing...'
                  : 'Processing...'
              }
              disabled={status !== 'ready'}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || status !== 'ready'}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>

          <div className="mt-2 text-xs text-gray-500 text-center">
            The assistant can conduct autonomous research or answer questions directly
          </div>
        </div>
      </div>

      {/* Brain Side Panel */}
      {showBrain && (
        <div className="w-1/3 border-l bg-white flex flex-col">
          {/* Brain Header */}
          <div className="border-b p-4 bg-blue-50">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🧠</span>
              <div>
                <h2 className="text-lg font-bold">Research Brain</h2>
                <p className="text-xs text-gray-600">Accumulated knowledge</p>
              </div>
            </div>
          </div>

          {/* Brain Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {brain ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{brain}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-center text-gray-500 mt-8">
                <span className="text-4xl block mb-2">🧠</span>
                <p className="text-sm">No research findings yet.</p>
                <p className="text-xs mt-1">Start researching to see accumulated knowledge here.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
