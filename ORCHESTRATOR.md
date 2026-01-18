# Chat Orchestrator with Research Executor

## Overview

The Chat Orchestrator is an intelligent conversational agent that decides when to use autonomous research versus responding directly. This creates a clean separation of concerns:

- **Orchestrator Chat Agent**: Analyzes messages and makes routing decisions
- **Research Executor Agent**: Autonomous multi-step research using ToolLoopAgent
- **Shared Brain**: Accumulated research knowledge visible in real-time

## Architecture

```
User Message
    ↓
Orchestrator Chat Agent (Decision Maker)
    ├─→ Chat Response (casual conversation, simple questions, clarifications)
    └─→ Start Research (complex questions requiring web research)
            ↓
        Research Executor Agent (ToolLoopAgent)
            ├─ Perplexity search
            ├─ Save to brain
            ├─ Think & plan next query
            └─ Loop up to 30 steps
            ↓
        Stream updates to chat (SSE)
```

## Key Components

### 1. Orchestrator Chat Agent (`lib/agents/orchestrator-chat-agent.ts`)

Main agent that analyzes each user message and decides:

**Decision Types:**
- `chat_response` - Answer directly without research
- `start_research` - Launch autonomous research executor

**Features:**
- Uses Claude Sonnet 4.5 for decision making
- Considers conversation history and accumulated brain
- Makes binary routing decisions (no "clarify" - just asks in chat)

### 2. Research Executor Agent (`lib/agents/research-executor-agent.ts`)

Autonomous research agent using AI SDK's ToolLoopAgent:

**Features:**
- Runs for up to 30 steps automatically
- Uses Perplexity AI for web searches
- Accumulates findings in shared brain
- Streams real-time progress via SSE
- Auto-saves research after each query

### 3. API Routes

#### Start New Chat Session
```
POST /api/chat/start
Response: {
  sessionId: string
  status: 'created'
  message: string
}
```

#### Send Message (SSE Stream)
```
POST /api/chat/[id]/message
Body: { message: string }
Response: Server-Sent Events stream with:
  - type: 'analyzing' | 'decision' | 'research_started' | 'message' | 'brain_update' | 'complete' | 'error'
  - Progressive updates during research
  - Real-time brain updates
  - Final completion message
```

#### Stop Research
```
POST /api/chat/[id]/stop
Response: {
  success: boolean
}
```

## Usage Example

### Frontend Integration (React Hook)

```typescript
import { useChatAgent } from '@/hooks/useChatAgent';

function ChatComponent() {
  const {
    messages,
    brain,
    isResearching,
    sendMessage,
    stopResearch
  } = useChatAgent();

  // Send a message
  await sendMessage("What are the latest developments in quantum computing?");

  // The hook handles:
  // - SSE streaming
  // - Real-time brain updates
  // - Message history
  // - Research progress
}
```

### Backend Integration

```typescript
import { analyzeUserMessage } from '@/lib/agents/orchestrator-chat-agent';
import { executeResearch } from '@/lib/agents/research-executor-agent';

// Analyze message
const decision = await analyzeUserMessage(
  userMessage,
  conversationHistory,
  currentBrain
);

// decision.type: 'chat_response' | 'start_research'
// decision.message: Response text (if chat_response)
// decision.researchObjective: Research goal (if start_research)

// Execute research if needed
if (decision.type === 'start_research') {
  await executeResearch({
    chatSessionId,
    userId,
    researchObjective: decision.researchObjective,
    onProgress: (update) => {
      // Stream updates to frontend
    }
  });
}
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

## Key Features

| Feature | Description |
|---------|-------------|
| **Smart Routing** | Automatically decides between chat response and research |
| **Conversational** | Natural back-and-forth conversation with context |
| **Autonomous Research** | ToolLoopAgent runs multi-step research automatically |
| **Real-time Updates** | SSE streaming shows progress as it happens |
| **Shared Brain** | Accumulated knowledge visible and searchable |
| **Perplexity Integration** | High-quality web research with citations |
| **Credit Efficient** | Only uses research when truly needed |

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
