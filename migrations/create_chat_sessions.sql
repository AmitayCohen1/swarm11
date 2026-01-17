-- Create chat_sessions table for chat-based orchestrator pattern
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),

  -- Conversation history
  messages JSONB DEFAULT '[]' NOT NULL,

  -- Shared brain
  brain TEXT DEFAULT '',

  -- Status
  status TEXT NOT NULL DEFAULT 'active',

  -- Credits
  credits_used INTEGER NOT NULL DEFAULT 0,

  -- Current research state
  current_research JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions(created_at DESC);
