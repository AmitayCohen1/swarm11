# Swarm11 Cortex Architecture

## Overview

A three-tier autonomous research system:

```
User → Intake Agent → Cortex Orchestrator → Initiative Agents → Web Search
                              ↓
                    CortexDoc (Brain/Memory)
```

---

## Core Components

### 1. Intake Agent (`lib/agents/intake-agent.ts`)

**Purpose:** Clarify user intent before starting research.

**Philosophy: Inference-Hostile**
- NEVER guesses objectives, use-cases, or success criteria
- If ANYTHING is unclear → ASK
- Friction is better than wrong research
- Only starts when ALL THREE are clear:
  1. What exactly should be researched
  2. Why the user needs it (what decision/action it supports)
  3. What success looks like

**Decision Types:**
| Type | When |
|------|------|
| `text_input` | Direct answer or clarifying question |
| `multi_choice_select` | Resolve ambiguity with 2-4 options |
| `start_research` | All criteria satisfied |

**Output:** `ResearchBrief` with `objective` and `successCriteria[]`

---

### 2. Cortex Orchestrator (`lib/agents/cortex-orchestrator.ts`)

**Purpose:** Manage the full research lifecycle.

**Phases:**

```
PHASE 1: Initialize CortexDoc
    ↓
PHASE 2: Generate 3 Initiatives (if none exist)
    ↓
PHASE 3: Execute Initiatives (sequential in v1)
    │
    ├─→ Run initiative to completion
    │       ↓
    │   Initiative Agent loop
    │       ↓
    └─→ Evaluate: continue / drill_down / spawn_new / synthesize
    ↓
PHASE 4: Adversarial Review
    ↓
PHASE 5: Synthesize Final Answer
```

**Evaluation Decisions:**
| Action | When |
|--------|------|
| `continue` | More pending initiatives to run |
| `drill_down` | Initiative found something worth deeper exploration |
| `spawn_new` | Gap identified, need new angle |
| `synthesize` | Sufficient evidence gathered |

**Real-Time Saves:**
Every `doc_updated` event triggers immediate DB persistence.

---

### 3. Initiative Agent (`lib/agents/initiative-agent.ts`)

**Purpose:** Execute one research initiative with enforced reasoning.

**Strict Tool Flow:**
```
search(1 query) → search_reasoning() → search(1 query) → search_reasoning() → ...
```

**State Machine Enforcement:**
```typescript
let awaitingReasoning = false;

// After search():
awaitingReasoning = true;
// Only search_reasoning tool available

// After search_reasoning():
awaitingReasoning = false;
// All tools available
```

**Available Tools:**

| Tool | Purpose | When Available |
|------|---------|----------------|
| `search` | Execute web search (1 query max) | When NOT awaiting reasoning |
| `search_reasoning` | Explain what was learned | REQUIRED after every search |
| `add_finding` | Record a fact with sources | When NOT awaiting reasoning |
| `edit_finding` | Update existing finding | When NOT awaiting reasoning |
| `disqualify_finding` | Mark finding as invalid | When NOT awaiting reasoning |
| `reflect` | Cycle-level reflection | When NOT awaiting reasoning |
| `done` | Complete this initiative | When NOT awaiting reasoning |

**Context Provided:**
- Overall research objective
- Success criteria (for whole research)
- List of ALL sibling initiatives with status
- ALL previous search results (no truncation)
- ALL previous reflections
- Current initiative details (name, description, goal)

---

### 4. Cortex Agent (`lib/agents/cortex-agent.ts`)

**Purpose:** Higher-level reasoning functions.

**Functions:**
| Function | Purpose |
|----------|---------|
| `generateInitiatives()` | Create 3 research angles from objective |
| `evaluateInitiatives()` | Decide next action after running initiatives |
| `synthesizeFinalAnswer()` | Combine findings into final answer |
| `adversarialReview()` | Challenge findings before synthesis |

---

## Data Structures

### CortexDoc (Brain)

Stored as JSON in `chat_sessions.brain`:

```typescript
interface CortexDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  status: 'running' | 'synthesizing' | 'complete';
  initiatives: Initiative[];
  cortexLog: CortexDecision[];
  finalAnswer?: string;
}
```

### Initiative

```typescript
interface Initiative {
  id: string;                    // e.g., "init-abc123"
  name: string;                  // Short label: "Market Analysis"
  description: string;           // Why this matters
  goal: string;                  // What we're looking for
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;             // Default: 10
  findings: Finding[];
  searchResults: SearchResult[];
  reflections: CycleReflection[];
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;
}
```

### SearchResult

```typescript
interface SearchResult {
  query: string;                 // Human-readable question
  answer: string;                // Tavily's answer
  sources: { url: string; title?: string }[];
  reasoning?: string;            // What we learned (from search_reasoning)
}
```

### Finding

```typescript
interface Finding {
  id: string;
  content: string;
  sources: { url: string; title: string }[];
  status: 'active' | 'disqualified';
  disqualifyReason?: string;
}
```

### CycleReflection

```typescript
interface CycleReflection {
  cycle: number;
  learned: string;
  nextStep: string;
  status: 'continue' | 'done';
}
```

---

## Memory Operations (`lib/utils/initiative-operations.ts`)

### Document Operations
| Function | Purpose |
|----------|---------|
| `initializeCortexDoc(objective, criteria)` | Create new CortexDoc |
| `serializeCortexDoc(doc)` | JSON.stringify for storage |
| `parseCortexDoc(json)` | Parse and validate |

### Initiative Operations
| Function | Purpose |
|----------|---------|
| `addInitiative(doc, name, desc, goal)` | Add new initiative |
| `startInitiative(doc, id)` | Set status to running |
| `completeInitiative(doc, id, summary, confidence, rec)` | Mark done |
| `getPendingInitiatives(doc)` | Get pending initiatives |
| `getRunningInitiatives(doc)` | Get running initiatives |

### Finding Operations
| Function | Purpose |
|----------|---------|
| `addFindingToInitiative(doc, initId, content, sources)` | Add finding |
| `editFindingInInitiative(doc, initId, findingId, content)` | Update finding |
| `disqualifyFindingInInitiative(doc, initId, findingId, reason)` | Invalidate |

### Search/Reflection Operations
| Function | Purpose |
|----------|---------|
| `addSearchResultToInitiative(doc, initId, query, answer, sources, reasoning)` | Record search |
| `addReflectionToInitiative(doc, initId, cycle, learned, nextStep, status)` | Record reflection |
| `hasQueryBeenRunInInitiative(doc, initId, query)` | Dedup check |

### Formatting
| Function | Purpose |
|----------|---------|
| `formatCortexDocForAgent(doc)` | Full doc summary for agents |
| `formatInitiativeForAgent(initiative)` | Single initiative detail |
| `getInitiativesSummary(doc)` | Quick status overview |

---

## Database

### `chat_sessions` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Session ID |
| `messages` | jsonb | Conversation history |
| `brain` | text | CortexDoc JSON |
| `status` | text | active / researching / completed |
| `creditsUsed` | int | Token usage |

### `research_sessions` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Research session ID |
| `chatSessionId` | uuid | FK to chat_sessions |
| `objective` | text | Research goal |
| `successCriteria` | text | Success definition |
| `status` | text | running / completed / stopped / error |
| `confidenceLevel` | text | low / medium / high |
| `finalAnswer` | text | Research conclusion |

### `search_queries` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Query ID |
| `researchSessionId` | uuid | FK to research_sessions |
| `query` | text | The search query |
| `queryNormalized` | text | Lowercase for dedup |
| `answer` | text | Tavily answer |
| `sources` | jsonb | Array of {url, title} |
| `cycleNumber` | int | Which eval round |

---

## Message Flow

```
1. User sends message
   ↓
2. POST /api/chat/[id]/message (SSE stream)
   ↓
3. Intake Agent analyzes
   ├─→ Ask clarification → return question
   └─→ Start research → continue
   ↓
4. Cortex Orchestrator
   ├─→ Initialize CortexDoc
   ├─→ Generate initiatives
   ├─→ For each initiative:
   │       └─→ Initiative Agent loop (search → reason → ...)
   │       └─→ Save to DB after each step
   │       └─→ Emit SSE events
   ├─→ Evaluate after all complete
   ├─→ Adversarial review
   └─→ Synthesize final answer
   ↓
5. Stream final answer to UI
```

---

## SSE Events

### Research Lifecycle
| Event | Data |
|-------|------|
| `cortex_initialized` | `{ objective, successCriteria, version }` |
| `initiative_started` | `{ initiativeId, name, goal }` |
| `search_completed` | `{ initiativeId, query, answer, sources }` |
| `reasoning_completed` | `{ initiativeId, reasoning }` |
| `reflection_completed` | `{ initiativeId, learned, nextStep }` |
| `initiative_completed` | `{ initiativeId, confidence, recommendation }` |
| `review_started` | `{}` |
| `review_completed` | `{ verdict, critique, missing }` |
| `synthesizing_started` | `{}` |
| `research_complete` | `{ totalInitiatives, totalFindings, confidence }` |

### State Updates
| Event | Data |
|-------|------|
| `doc_updated` | `{ doc }` (full CortexDoc) |
| `brain_update` | `{ brain }` (serialized JSON) |

---

## Key Files

```
lib/
├── agents/
│   ├── intake-agent.ts           # Intent clarification
│   ├── cortex-agent.ts           # Generate/evaluate/synthesize
│   ├── cortex-orchestrator.ts    # Full flow management
│   └── initiative-agent.ts       # Single initiative execution
├── types/
│   └── initiative-doc.ts         # Zod schemas + types
├── tools/
│   └── tavily-search.ts          # Web search (1 query max)
└── utils/
    └── initiative-operations.ts  # CortexDoc helpers

hooks/
└── useChatAgent.ts               # SSE + React state

components/chat/
├── ChatAgentView.tsx             # Main chat UI
└── ResearchProgress.tsx          # Tabbed initiative view

app/api/chat/
├── start/route.ts                # Create session
├── [id]/message/route.ts         # Message handler (SSE)
└── [id]/stop/route.ts            # Stop research
```

---

## Design Decisions

### Why Inference-Hostile Intake?

**Problem:** AI tends to infer intent and start research with wrong assumptions.

**Solution:** Explicitly forbid guessing. The intake prompt says:
- "Your job is NOT to guess"
- "If anything important is unclear, ASK"
- "Asking one good question is always better than starting the wrong research"

### Why One Search at a Time?

**Problem:** Batching searches loses reasoning context.

**Solution:** State machine enforces:
```
search(1) → must call search_reasoning → can search again
```

This ensures every search gets explicit reasoning about what was learned.

### Why Full Context (No Truncation)?

**Problem:** Truncating history loses important context for decisions.

**Solution:** Initiative agents receive:
- ALL previous search results
- ALL previous reflections
- Full objective and sibling initiative list

Memory is cheap. Wrong decisions are expensive.

### Why Real-Time Saves?

**Problem:** Long research sessions risk losing progress.

**Solution:** Save to DB after every:
- Search completion
- Reasoning completion
- Reflection completion

User sees real-time progress. Crash recovery is automatic.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** Neon PostgreSQL + Drizzle ORM
- **Auth:** Clerk
- **AI:** OpenAI GPT-4.1 (intake/cortex), GPT-4.1-mini (initiatives)
- **Search:** Tavily API
- **UI:** Tailwind + Framer Motion
