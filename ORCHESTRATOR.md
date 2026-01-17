# Orchestrator Agent with Research Tool

## Overview

The Orchestrator Agent is an intelligent agent that decides when to use a dedicated research tool versus responding directly. This creates a clean separation of concerns where:

- **Orchestrator Agent**: Main decision-making agent that routes requests
- **Research Tool**: Specialized tool that generates research questions and executes them via Perplexity AI

## Architecture

```
User Message
    ↓
Orchestrator Agent (Decision Maker)
    ├─→ Respond directly (casual conversation, simple questions)
    ├─→ Ask clarifying questions (ambiguous requests)
    └─→ Use Research Tool (complex research needs)
            ├─ Generate focused research questions
            ├─ Execute via Perplexity AI
            └─ Synthesize structured results
```

## Key Components

### 1. Research Tool (`lib/tools/research-tool.ts`)

A dedicated agent that:
- **Generates research questions** using Claude to break down complex objectives
- **Executes questions** using Perplexity AI (sonar-pro model)
- **Synthesizes findings** into structured, cited outputs

**Key Features:**
- Parallel execution of multiple research questions
- Structured output with confidence levels
- Automatic source citation and deduplication
- Follow-up suggestion generation

### 2. Orchestrator Agent (`lib/agents/orchestrator-agent.ts`)

Main agent that decides how to handle each user message:

**Decision Types:**
- `respond` - Answer directly without research
- `research` - Invoke the research tool
- `clarify` - Ask user for more information

**State Management:**
- Maintains conversation history
- Tracks last research results
- Builds context for research tool

### 3. API Routes

#### Start New Session
```
POST /api/orchestrator/start
Body: { message: string }
Response: {
  sessionId: string
  action: 'respond' | 'research' | 'clarify'
  message: string
  researchResult?: ResearchToolOutput
  creditsUsed: number
  userCredits: number
}
```

#### Send Message
```
POST /api/orchestrator/[id]/message
Body: { message: string }
Response: {
  sessionId: string
  action: string
  message: string
  researchResult?: ResearchToolOutput
  creditsUsed: number
  totalCreditsUsed: number
  userCredits: number
}
```

#### Get Session
```
GET /api/orchestrator/[id]
Response: {
  session: OrchestratorSession
  userCredits: number
}
```

#### Stop Session
```
POST /api/orchestrator/[id]/stop
Response: {
  sessionId: string
  status: 'stopped'
}
```

## Usage Example

### Frontend Integration

```typescript
// Start a conversation
const response = await fetch('/api/orchestrator/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What are the latest developments in quantum computing?'
  })
});

const data = await response.json();

// If action is 'research', data.researchResult contains:
// - questions: Array of research questions that were investigated
// - results: Array of question-answer pairs with sources
// - structuredResult: {
//     summary: string (comprehensive markdown summary)
//     keyFindings: string[]
//     sources: Array<{ title, url, relevance }>
//     confidenceLevel: 'high' | 'medium' | 'low'
//     suggestedFollowUps?: string[]
//   }

// Continue the conversation
const followUp = await fetch(`/api/orchestrator/${data.sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Can you tell me more about quantum error correction?'
  })
});
```

### Backend Integration

```typescript
import { createOrchestratorAgent, createInitialState } from '@/lib/agents/orchestrator-agent';

const orchestrator = createOrchestratorAgent();
const state = createInitialState();

const result = await orchestrator.process(
  'What are the latest AI breakthroughs?',
  state
);

// result.action: 'respond' | 'research' | 'clarify'
// result.message: Message to show user
// result.researchResult: (if action === 'research')
// result.creditsUsed: Credits consumed
// result.state: Updated state for next interaction
```

## Environment Variables

Add to your `.env.local`:

```bash
# Existing
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
EXA_API_KEY=... # (still used by legacy research agent)

# New - Required for Orchestrator
PERPLEXITY_API_KEY=pplx-... # Get from https://www.perplexity.ai/settings/api
```

## Database Migration

Run the migration to add the `orchestrator_sessions` table:

```bash
# Generate migration
npx drizzle-kit generate

# Apply migration
npx drizzle-kit push
```

Or manually create the table:

```sql
CREATE TABLE orchestrator_sessions (
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
```

## Credit Costs

| Operation | Credits |
|-----------|---------|
| Decision making | ~20 |
| Research tool execution | ~160 |
| - Question generation | ~50 |
| - Per Perplexity search | ~10 |
| - Synthesis | ~100 |
| **Total per research message** | ~200 |

## Structured Output Schemas

### Research Questions Schema
```typescript
{
  questions: Array<{
    question: string
    reasoning: string
    priority: 'high' | 'medium' | 'low'
  }>
  approach: string
}
```

### Research Result Schema
```typescript
{
  summary: string // Comprehensive markdown summary
  keyFindings: string[]
  sources: Array<{
    title: string
    url: string
    relevance: string
  }>
  confidenceLevel: 'high' | 'medium' | 'low'
  suggestedFollowUps?: string[]
}
```

### Orchestrator Decision Schema
```typescript
{
  action: 'respond' | 'research' | 'clarify'
  reasoning: string
  content: string // Response text or research objective
  needsContext?: boolean
}
```

## Benefits Over Legacy Research Agent

| Feature | Legacy Agent | Orchestrator + Research Tool |
|---------|--------------|------------------------------|
| **Casual conversation** | Over-engineers simple responses | Responds directly without research |
| **Clarification** | Limited | Asks for clarification when needed |
| **Research quality** | Exa neural search | Perplexity AI with citations |
| **Structured output** | Basic | Rich with confidence levels, follow-ups |
| **Modularity** | Monolithic | Separated concerns |
| **Reusability** | Tightly coupled | Research tool can be used by any agent |

## When Each Action is Chosen

### `respond` - Direct Response
- Simple factual questions
- Casual conversation
- Follow-ups to previous research
- No external data needed

### `research` - Use Research Tool
- Complex topics requiring current information
- Questions needing comprehensive analysis
- User explicitly asks for research
- Need cited, authoritative sources

### `clarify` - Ask User
- Vague or ambiguous requests
- Multiple interpretations possible
- Need context to provide good answer
- Critical decision points

## Example Conversations

### Simple Question (respond)
```
User: "What is machine learning?"
Orchestrator: [responds directly with clear explanation]
```

### Complex Research (research)
```
User: "What are the latest breakthroughs in fusion energy?"
Orchestrator: [uses research tool]
  ├─ Generates questions about recent experiments, technologies, challenges
  ├─ Executes via Perplexity
  └─ Returns comprehensive summary with citations
```

### Ambiguous Request (clarify)
```
User: "Tell me about AI"
Orchestrator: "AI is a broad topic! Would you like to know about:
  - Recent AI breakthroughs and news
  - How AI works technically
  - AI applications in a specific field
  - Ethical considerations of AI"
```

## Testing

### Test the Research Tool Directly

```typescript
import { createResearchTool } from '@/lib/tools/research-tool';

const tool = createResearchTool();

const result = await tool.execute({
  objective: 'What are the latest developments in quantum computing?',
  maxQuestions: 3
});

console.log('Questions:', result.questions);
console.log('Key Findings:', result.structuredResult.keyFindings);
console.log('Sources:', result.structuredResult.sources);
```

### Test the Orchestrator

```typescript
import { createOrchestratorAgent, createInitialState } from '@/lib/agents/orchestrator-agent';

const orchestrator = createOrchestratorAgent();
const state = createInitialState();

// Test casual response
const casual = await orchestrator.process('Hello!', state);
console.log('Action:', casual.action); // 'respond'

// Test research
const research = await orchestrator.process(
  'What are the latest AI breakthroughs?',
  casual.state
);
console.log('Action:', research.action); // 'research'
console.log('Research Result:', research.researchResult);
```

## Future Enhancements

1. **Tool Chaining**: Allow research tool to call other specialized tools
2. **Streaming**: Stream research results as they come in
3. **Caching**: Cache common research queries
4. **Multi-Tool Support**: Add more specialized tools (code search, data analysis, etc.)
5. **Custom Prompts**: Allow users to customize orchestrator decision logic
6. **Research Templates**: Pre-defined research strategies for common use cases

## Troubleshooting

### Perplexity API Errors
- Check API key is valid: https://www.perplexity.ai/settings/api
- Verify rate limits haven't been exceeded
- Check model name is correct (sonar-pro)

### High Credit Usage
- Adjust `maxQuestions` to reduce research depth
- Use legacy Exa agent for simpler searches
- Implement caching for common queries

### Poor Research Quality
- Ensure questions are specific and focused
- Increase `maxQuestions` for more comprehensive research
- Check Perplexity model settings (temperature, max_tokens)

## Migration from Legacy Agent

If you're migrating from the legacy research agent:

1. Keep existing `/api/research/*` routes for backward compatibility
2. Add new `/api/orchestrator/*` routes
3. Update frontend to use new orchestrator endpoints
4. Gradually migrate users to new system
5. Monitor credit usage and quality metrics

Both systems can coexist - use orchestrator for new features and keep legacy for existing workflows.
