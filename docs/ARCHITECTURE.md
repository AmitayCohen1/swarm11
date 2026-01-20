# Swarm10 Architecture

## Overview

Research assistant with autonomous web search and structured memory.

```
User → Orchestrator → Research Agent → Web Search
                ↓
            Brain (Memory)
```

---

## Core Components

### 1. Orchestrator (`lib/agents/orchestrator-chat-agent.ts`)
- Analyzes user intent
- Decides: respond, ask clarification, or start research
- Creates research briefs with objective + success criteria

### 2. Research Executor (`lib/agents/research-executor-agent.ts`)
- Autonomous search loop: `search() → reflect() → repeat`
- Stops when confidence threshold met
- Saves findings to brain after each cycle

### 3. Brain / Memory (`lib/utils/research-memory.ts`)
- Stored as JSON in `chat_sessions.brain` field
- Tracks full research cycles: queries, results, learnings
- Orchestrator reads formatted summary for context

---

## Memory System

### How It Works

Memory is stored as JSON in the `brain` TEXT field. No schema migrations needed.

```
Session Start → Empty brain
     ↓
Research Start → createResearchMemory(objective, criteria)
     ↓
Search Complete → addSearchToMemory(memory, searchResult)
     ↓
Reflect Tool → completeCycle(memory, learned, nextStep)
     ↓
Next Cycle → startCycle(memory, intent)
     ↓
Orchestrator → formatForOrchestrator(memory) → LLM context
```

### Memory Functions (`lib/utils/research-memory.ts`)

| Function | Purpose |
|----------|---------|
| `parseResearchMemory(brain)` | Parse JSON or detect legacy markdown |
| `serializeResearchMemory(memory)` | JSON.stringify for storage |
| `createResearchMemory(objective)` | Initialize new memory |
| `startCycle(memory, intent)` | Begin new research cycle |
| `addSearchToMemory(memory, search)` | Add search result to current cycle |
| `completeCycle(memory, learned, next)` | Finalize cycle with learnings |
| `hasQueryBeenRun(memory, query)` | Dedup check (normalized) |
| `formatForOrchestrator(memory)` | Structured summary for LLM |

### Save Points

| Event | Location | Action |
|-------|----------|--------|
| Research starts | `message/route.ts` | `createResearchMemory()` |
| Search completes | `research-executor-agent.ts` | `addSearchToMemory()` |
| Agent reflects | `research-executor-agent.ts` | `completeCycle()` + `startCycle()` |

### Example: What a Cycle Looks Like

```json
{
  "version": 1,
  "objective": "Find top 3 AI startups in healthcare",
  "successCriteria": "Companies with Series B+ funding and FDA approvals",
  "queriesRun": [
    "AI healthcare startups Series B funding 2024",
    "FDA approved AI medical devices companies"
  ],
  "cycles": [
    {
      "timestamp": "2024-01-15T10:42:00Z",
      "intent": "Initial exploration of AI healthcare landscape",
      "searches": [
        {
          "query": "AI healthcare startups Series B funding 2024",
          "purpose": "Find well-funded companies in the space",
          "answer": "Found 12 companies including Tempus, Viz.ai, PathAI...",
          "sources": [
            { "url": "https://techcrunch.com/...", "title": "Top AI Healthcare Startups" },
            { "url": "https://crunchbase.com/...", "title": "Series B Healthcare AI" }
          ]
        }
      ],
      "learned": "Identified 12 candidates. Tempus and Viz.ai are leaders with $500M+ raised.",
      "nextStep": "Verify FDA approval status for top candidates"
    },
    {
      "timestamp": "2024-01-15T10:45:00Z",
      "intent": "Verify FDA approval status for top candidates",
      "searches": [
        {
          "query": "FDA approved AI medical devices companies",
          "purpose": "Filter to companies with regulatory approval",
          "answer": "Viz.ai, IDx, Caption Health have FDA clearances...",
          "sources": [
            { "url": "https://fda.gov/...", "title": "AI Medical Devices" }
          ]
        }
      ],
      "learned": "Narrowed to 5 companies with FDA approval. Viz.ai has 4 clearances.",
      "nextStep": "stop"
    }
  ]
}
```

### How Memory is Saved

```typescript
// 1. Research starts - create memory
const memory = createResearchMemory(objective, successCriteria);
await db.update(chatSessions)
  .set({ brain: serializeResearchMemory(memory) });

// 2. Search completes - add results
memory = addSearchToMemory(memory, {
  query: "AI healthcare startups...",
  purpose: "Find well-funded companies",
  answer: "Found 12 companies...",
  sources: [...]
});
await db.update(chatSessions)
  .set({ brain: serializeResearchMemory(memory) });

// 3. Agent reflects - complete cycle
memory = completeCycle(memory,
  "Identified 12 candidates...",  // learned
  "Verify FDA approval status"    // nextStep
);
memory = startCycle(memory, "Verify FDA approval status");
await db.update(chatSessions)
  .set({ brain: serializeResearchMemory(memory) });
```

Each save is a full JSON overwrite to the `brain` TEXT field.

---

### Migration Strategy

- **No DB migration** - brain stays TEXT
- **Runtime detection** - `parseResearchMemory()` checks if JSON or markdown
- **Legacy support** - old markdown preserved in `legacyBrain` field

```typescript
// Auto-detects format
function parseResearchMemory(brain: string) {
  if (brain.startsWith('{')) → parse as JSON
  else → wrap in { legacyBrain: brain }
}
```

---

## Data Structures

### ResearchMemory
```typescript
{
  version: 1,
  objective: string,
  successCriteria?: string,
  cycles: ResearchCycle[],
  queriesRun: string[]        // flat list for dedup
  legacyBrain?: string        // old markdown sessions
}
```

### ResearchCycle
```typescript
{
  timestamp: string,
  intent: string,             // why searching
  searches: SearchResult[],
  learned: string,            // what we learned
  nextStep: string            // what to do next
}
```

### SearchResult
```typescript
{
  query: string,
  purpose: string,
  answer: string,
  sources: { url: string, title: string }[]
}
```

---

## URL Routing

| URL | Purpose |
|-----|---------|
| `/chat` | New session (redirects to `/chat/[id]`) |
| `/chat/[id]` | Active session |
| `/sessions` | List all sessions |

URL updates use `window.history.replaceState()` for shallow routing (no remount).

---

## Database

### `chat_sessions` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Session ID |
| `messages` | jsonb | Conversation history |
| `brain` | text | Research memory (JSON) |
| `status` | text | active / researching / completed |
| `creditsUsed` | int | Token usage tracking |

### `research_sessions` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Research session ID |
| `chatSessionId` | uuid | FK to chat_sessions |
| `objective` | text | Research goal |
| `successCriteria` | text | What defines success |
| `status` | text | running / completed / stopped / error |
| `confidenceLevel` | text | low / medium / high |
| `finalAnswer` | text | Research conclusion |
| `totalSteps` | int | Number of iterations |
| `totalCost` | real | Credits used |

### `search_queries` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Query ID |
| `researchSessionId` | uuid | FK to research_sessions |
| `query` | text | The search query |
| `queryNormalized` | text | Lowercase for dedup |
| `purpose` | text | Why this query |
| `answer` | text | Tavily answer |
| `sources` | jsonb | Array of {url, title} |
| `wasUseful` | bool | Feedback for learning |
| `cycleNumber` | int | Which research cycle |

### Cross-Session Query Helpers (`lib/utils/search-history.ts`)

| Function | Purpose |
|----------|---------|
| `findSimilarQueries(query)` | Find past similar searches |
| `hasQueryBeenRunGlobally(query)` | Exact match dedup |
| `getMostFrequentQueries()` | Analytics |
| `getUserResearchHistory(userId)` | User's past research |
| `getResearchSessionQueries(id)` | Queries from a session |
| `markQueryUsefulness(id, bool)` | Feedback for learning |
| `getResearchStats(userId?)` | Aggregate stats |

---

## Message Flow

```
1. User sends message
   ↓
2. POST /api/chat/[id]/message (SSE stream)
   ↓
3. Orchestrator analyzes → decides action
   ↓
4. If research:
   - Create ResearchMemory
   - Loop: search → reflect → update brain
   - Stream progress events to UI
   ↓
5. Return final answer
```

---

## Key Files

```
lib/
├── agents/
│   ├── orchestrator-chat-agent.ts   # Intent analysis
│   └── research-executor-agent.ts   # Search loop
├── types/
│   └── research-memory.ts           # Type definitions
├── utils/
│   └── research-memory.ts           # Memory helpers
└── db/
    └── schema.ts                    # Database schema

app/
├── chat/
│   ├── page.tsx                     # New session
│   └── [id]/page.tsx                # Existing session
└── api/chat/
    ├── start/route.ts               # Create session
    ├── sessions/route.ts            # List sessions
    └── [id]/
        ├── route.ts                 # Get/delete session
        ├── message/route.ts         # Send message (SSE)
        └── stop/route.ts            # Stop research

components/chat/
├── ChatAgentView.tsx                # Main UI
└── SessionsSidebar.tsx              # Session list
```

---

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Neon PostgreSQL + Drizzle ORM
- **Auth**: Clerk
- **AI**: OpenAI GPT-4, Anthropic Claude
- **Search**: Tavily API
- **UI**: Tailwind + Radix
