-- Create autonomous_sessions table for AI SDK v6 ToolLoopAgent pattern
CREATE TABLE IF NOT EXISTS autonomous_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),

  -- Objective
  objective TEXT NOT NULL,

  -- Brain (accumulated knowledge)
  brain TEXT DEFAULT '',

  -- Status
  status TEXT NOT NULL DEFAULT 'active',
  -- Values: 'active' | 'waiting_for_user' | 'completed' | 'stopped' | 'failed' | 'insufficient_credits'

  -- Query tracking
  queries_executed INTEGER NOT NULL DEFAULT 0,
  max_queries INTEGER NOT NULL DEFAULT 20,

  -- Credits
  credits_used INTEGER NOT NULL DEFAULT 0,

  -- Agent state
  iteration_count INTEGER DEFAULT 0,
  last_reasoning JSONB,

  -- Interactive mode
  pending_question JSONB,
  pending_response TEXT,

  -- Results
  final_report TEXT,
  stop_reason TEXT,
  -- Values: 'goal_achieved' | 'max_queries' | 'user_stopped' | 'insufficient_credits' | 'timeout'

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_user ON autonomous_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_status ON autonomous_sessions(status);
CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_created ON autonomous_sessions(created_at DESC);
