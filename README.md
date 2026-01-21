# Swarm11 - Autonomous Research Agent

An autonomous research agent that uses AI SDK 6's `ToolLoopAgent` with strict tool ordering to conduct strategic research. The agent plans initiatives, searches the web, reflects on findings, and delivers actionable intelligence.

## Architecture Overview

```
User Message
    ↓
Orchestrator Agent (Claude Sonnet 4.5)
    ├─→ Chat Response (greetings)
    ├─→ Ask Clarification (vague requests)
    └─→ Start Research (clear objective)
            ↓
        Research Executor (GPT-4.1 + ToolLoopAgent)
            ↓
        plan() → search() → reflect() → [loop or finish()]
            ↓
        SSE Stream → UI (Event Log + Exploration List)
```

### Why Two Models?

| Model | Role | Why |
|-------|------|-----|
| **Claude Sonnet 4.5** | Orchestrator | Better at understanding intent, asking clarifying questions |
| **GPT-4.1** | Research Executor | Better at following strict tool workflows, cheaper for loops |

## Tool Flow (Strict Ordering)

The research executor enforces a strict tool calling sequence using AI SDK 6's `prepareStep`:

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────────────┐
│  plan() │ ──→ │ search()│ ──→ │reflect()│ ──→ │ search() or     │
└─────────┘     └─────────┘     └─────────┘     │ finish()        │
                                                └─────────────────┘
                                                        │
                                                        ↓
                                               hasToolCall('finish')
                                                   stops loop
```

### Tools

| Tool | Purpose | When Called |
|------|---------|-------------|
| `plan()` | Create 1-2 research initiatives | First, once |
| `search()` | Web search via Tavily | After plan or reflect |
| `reflect()` | Analyze findings, update initiatives | After every search |
| `finish()` | Deliver final answer | When research complete |

### Why This Flow?

1. **plan()** forces the model to think before searching
2. **reflect()** after every search prevents aimless searching
3. **finish()** as explicit tool enables clean `hasToolCall('finish')` termination
4. No shared mutable state - just tool calls and stop conditions

## AI SDK 6 Patterns Used

### 1. `hasToolCall()` for Clean Termination

```typescript
import { hasToolCall, stepCountIs } from 'ai';

stopWhen: [hasToolCall('finish'), stepCountIs(100)]
```

**Why:** No shared mutable state. The `finish` tool is the completion signal.
**Docs:** [hasToolCall Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/has-tool-call)

### 2. `prepareStep()` for Tool Ordering

```typescript
prepareStep: async ({ steps }) => {
  const lastTool = steps.flatMap(s => s.toolCalls || []).at(-1)?.toolName;

  if (!hasPlan) return { activeTools: ['plan'], toolChoice: { type: 'tool', toolName: 'plan' } };
  if (lastTool === 'search') return { activeTools: ['reflect'], toolChoice: { type: 'tool', toolName: 'reflect' } };
  if (lastTool === 'plan') return { activeTools: ['search'], toolChoice: { type: 'tool', toolName: 'search' } };
  if (lastTool === 'reflect') return { activeTools: ['search', 'finish'] }; // Model decides

  return {};
}
```

**Why:** Enforces plan→search→reflect cycle without callback spaghetti.
**Docs:** [Loop Control](https://ai-sdk.dev/docs/agents/loop-control)

### 3. `onStepFinish()` for Observability Only

```typescript
onStepFinish: async (step) => {
  // Logging, persistence, progress events
  // NOT for control flow
}
```

**Why:** Control flow belongs in `prepareStep`. `onStepFinish` is for side effects.

## File Structure

```
lib/
├── agents/
│   ├── orchestrator-chat-agent.ts   # Decision maker (Claude)
│   └── research-executor-agent.ts   # Research loop (GPT-4.1 + ToolLoopAgent)
├── tools/
│   └── tavily-search.ts             # Web search tool
└── utils/
    └── research-memory.ts           # Brain/memory serialization

hooks/
└── useChatAgent.ts                  # React hook for SSE + state

components/chat/
├── ChatAgentView.tsx                # Main chat UI
├── ExplorationList.tsx              # Research initiatives panel
└── EventLog.tsx                     # Real-time event timeline

app/api/chat/
├── start/route.ts                   # Create session
├── [id]/message/route.ts            # Send message (SSE)
└── [id]/stop/route.ts               # Stop research
```

## Key Files Explained

### `research-executor-agent.ts`

The core research loop. Key sections:

```typescript
// Line ~586: Stop condition - no shared state needed
stopWhen: [hasToolCall('finish'), stepCountIs(MAX_STEPS)],

// Line ~590: Tool ordering via prepareStep
prepareStep: async ({ steps }) => { ... }

// Line ~524: finish() tool - completion signal
const finishTool = tool({
  description: 'Call when research is complete',
  execute: async ({ confidenceLevel, finalAnswer }) => {
    // Auto-complete remaining initiatives
    // Emit final list state
    return { confidenceLevel, finalAnswer };
  }
});
```

### `useChatAgent.ts`

React hook managing:
- SSE connection for real-time updates
- Message state
- Research progress (objective, successCriteria, outputFormat)
- Exploration list state
- Event log

### `ExplorationList.tsx`

Shows research brief + initiatives:
- **Objective:** What we're researching
- **Success:** What counts as done
- **Format:** How to present results
- **Progress:** Visual progress bar
- **Initiatives:** Task tree with subtasks

### `EventLog.tsx`

Real-time event timeline:
- Plan started/completed
- Search queries executed
- Reflect decisions
- Phase changes

## SSE Event Types

```typescript
type EventType =
  | 'research_started'      // Research kicked off (includes full brief)
  | 'plan_started'          // Creating initiatives
  | 'plan_completed'        // Initiatives created
  | 'search_started'        // Queries being executed
  | 'search_completed'      // Results received
  | 'reasoning_started'     // Analyzing findings
  | 'reflect_completed'     // Decision made (continue/finish)
  | 'list_updated'          // Exploration list changed
  | 'list_operations'       // What changed (done, add, remove)
  | 'synthesizing_started'  // Writing final answer
  | 'research_complete'     // Done
  | 'message'               // Chat message
  | 'brain_update'          // Memory updated
  | 'error';                // Error occurred
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

```bash
# .env.local

# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Database
DATABASE_URL=postgresql://...

# AI Models
ANTHROPIC_API_KEY=sk-ant-...   # For orchestrator
OPENAI_API_KEY=sk-...          # For research executor

# Search
TAVILY_API_KEY=tvly-...
```

### 3. Database

```bash
npm run db:generate
npm run db:push
```

### 4. Run

```bash
npm run dev
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15, React 19 |
| AI | AI SDK 6, Claude Sonnet 4.5, GPT-4.1 |
| Search | Tavily AI |
| Database | Neon PostgreSQL + Drizzle |
| Auth | Clerk |
| Styling | Tailwind CSS |

## Design Decisions

### Why ToolLoopAgent over Custom Loop?

We considered a custom loop but chose ToolLoopAgent because:
1. Built-in streaming support
2. Type-safe tool definitions
3. `prepareStep` + `hasToolCall` provide clean control
4. Less boilerplate for common patterns

### Why `finish()` Tool Instead of Return Value?

```typescript
// ❌ Before: Shared mutable state
let researchComplete = false;
onStepFinish: () => { researchComplete = true; }
stopWhen: () => researchComplete && noToolCalls

// ✅ After: Clean stop condition
stopWhen: hasToolCall('finish')
```

The `finish()` tool pattern is documented in AI SDK and avoids callback coordination.

### Why Strict Tool Ordering?

Without ordering, the model might:
- Search repeatedly without reflecting
- Skip planning
- Never call finish

`prepareStep` with `toolChoice` enforcement guarantees the cycle.

### Why Auto-Complete Initiatives on Finish?

The model might call `finish()` before marking all initiatives done. Rather than block this (which could cause loops), we auto-complete remaining items so the UI shows all checkmarks.

## Links

- [AI SDK 6 Docs](https://ai-sdk.dev)
- [hasToolCall Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/has-tool-call)
- [Loop Control](https://ai-sdk.dev/docs/agents/loop-control)
- [prepareStep](https://ai-sdk.dev/docs/agents/building-agents)
- [Tavily API](https://tavily.com)
- [Neon](https://neon.tech)
- [Clerk](https://clerk.com)

## License

MIT
