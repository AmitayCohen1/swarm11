import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

// Load DATABASE_URL from .env.local
const envFile = readFileSync('.env.local', 'utf-8');
const databaseUrl = envFile
  .split('\n')
  .find(line => line.startsWith('DATABASE_URL='))
  ?.split('=')[1]
  ?.trim();

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found in .env.local');
  process.exit(1);
}

const sql = neon(databaseUrl);

console.log('Creating orchestrator_sessions table...');

try {
  await sql`
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
  `;

  console.log('✅ Table created successfully!');

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_user_id ON orchestrator_sessions(user_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_status ON orchestrator_sessions(status);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_created_at ON orchestrator_sessions(created_at DESC);`;

  console.log('✅ Indexes created successfully!');
  console.log('✅ Migration complete!');
} catch (error) {
  console.error('Error running migration:', error);
  process.exit(1);
}
