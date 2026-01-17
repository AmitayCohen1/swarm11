-- Migration: Add orchestrator_sessions table
-- Date: 2026-01-04
-- Description: Adds the orchestrator_sessions table for the new orchestrator agent

CREATE TABLE IF NOT EXISTS orchestrator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  credits_used INTEGER NOT NULL DEFAULT 0,
  conversation_history JSONB DEFAULT '[]',
  current_document TEXT,
  last_research_result JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_user_id ON orchestrator_sessions(user_id);

-- Add index for status filtering
CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_status ON orchestrator_sessions(status);

-- Add index for timestamp sorting
CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_created_at ON orchestrator_sessions(created_at DESC);
