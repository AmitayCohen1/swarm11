-- LLM Evaluations table (must be created first for foreign key)
CREATE TABLE IF NOT EXISTS llm_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  scores JSONB NOT NULL,
  insights TEXT,
  recommendations TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- LLM Calls table - tracks every LLM call
CREATE TABLE IF NOT EXISTS llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT,
  input JSONB NOT NULL,
  output JSONB NOT NULL,
  duration_ms INTEGER,
  token_count INTEGER,
  evaluated BOOLEAN DEFAULT FALSE,
  evaluation_batch_id UUID REFERENCES llm_evaluations(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_llm_calls_agent_name ON llm_calls(agent_name);
CREATE INDEX IF NOT EXISTS idx_llm_calls_evaluated ON llm_calls(evaluated);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created_at ON llm_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_evaluations_agent_name ON llm_evaluations(agent_name);
