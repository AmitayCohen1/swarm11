# Swarm11 Cortex Architecture

## Overview

A three-tier autonomous research system:

```
User → Intake Agent → Cortex Orchestrator → ResearchQuestion Agents → Web Search
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
PHASE 2: Generate 3 ResearchQuestions (if none exist)
    ↓
PHASE 3: Execute ResearchQuestions (sequential in v1)
    │
    ├─→ Run question to completion
    │       ↓
    │   ResearchQuestion Agent loop
    │       ↓
    └─→ Evaluate: continue / drill_down / spawn_new / synthesize
    ↓
PHASE 4: Synthesize Final Answer
```

**Evaluation Decisions:**
| Action | When |
|--------|------|
| `continue` | More pending questions to run |
| `drill_down` | ResearchQuestion found something worth deeper exploration |
| `spawn_new` | Gap identified, need new angle |
| `synthesize` | Sufficient evidence gathered |

**Real-Time Saves:**
Every `doc_updated` event triggers immediate DB persistence.

---

### 3. ResearchQuestion Agent (`lib/agents/question-agent.ts`)

**Purpose:** Execute one research question with a disciplined loop and structured memory.

**Strict Tool Flow:**
```
search(1 query) → reflect() → search(1 query) → reflect() → ...
```

After each `search`, the agent must call `reflect` before it can search again.

**Available Tools:**

| Tool | Purpose | When Available |
|------|---------|----------------|
| `search` | Execute web search (1 query max) | When NOT awaiting reflection |
| `reflect` | Record structured reflection + episode delta | REQUIRED after every search |

**Context Provided:**
- Overall research objective
- Success criteria (for whole research)
- List of ALL sibling questions with status
- ALL previous search results (no truncation)
- ALL previous reflections
- Current question details (name, description, goal)

---

### 4. Cortex Agent (`lib/agents/cortex-agent.ts`)

**Purpose:** Higher-level reasoning functions.

**Functions:**
| Function | Purpose |
|----------|---------|
| `generateResearchQuestions()` | Create 3 research angles from objective |
| `evaluateResearchQuestions()` | Decide next action after running questions |
| `synthesizeFinalAnswer()` | Combine findings into final answer |

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
  questions: ResearchQuestion[];
  cortexLog: CortexDecision[];
  finalAnswer?: string;
}
```

### ResearchQuestion

```typescript
interface ResearchQuestion {
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
  learned?: string;              // What we learned (from reflect)
  nextAction?: string;           // What to do next (from reflect)
}

### Episode (Structured Delta Memory)

Each `reflect` also appends an `Episode` entry, which is the primary unit Cortex should reason over:

```typescript
interface Episode {
  cycle: number;
  query: string;
  learned: string;
  stillNeed: string;
  deltaType: 'progress' | 'no_change' | 'dead_end';
  delta: string;
  dontRepeat: string[];
  nextStep: string;
  status: 'continue' | 'done';
}
```
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

## Memory Operations (`lib/utils/question-operations.ts`)

### Document Operations
| Function | Purpose |
|----------|---------|
| `initializeCortexDoc(objective, criteria)` | Create new CortexDoc |
| `serializeCortexDoc(doc)` | JSON.stringify for storage |
| `parseCortexDoc(json)` | Parse and validate |

### ResearchQuestion Operations
| Function | Purpose |
|----------|---------|
| `addResearchQuestion(doc, name, desc, goal)` | Add new question |
| `startResearchQuestion(doc, id)` | Set status to running |
| `completeResearchQuestion(doc, id, summary, confidence, rec)` | Mark done |
| `getPendingResearchQuestions(doc)` | Get pending questions |
| `getRunningResearchQuestions(doc)` | Get running questions |

### Finding Operations
| Function | Purpose |
|----------|---------|
| `addFindingToResearchQuestion(doc, initId, content, sources)` | Add finding |
| `editFindingInResearchQuestion(doc, initId, findingId, content)` | Update finding |
| `disqualifyFindingInResearchQuestion(doc, initId, findingId, reason)` | Invalidate |

### Search/Reflection Operations
| Function | Purpose |
|----------|---------|
| `addSearchResultToResearchQuestion(doc, initId, query, answer, sources, reasoning)` | Record search |
| `addReflectionToResearchQuestion(doc, initId, cycle, learned, nextStep, status)` | Record reflection |
| `hasQueryBeenRunInResearchQuestion(doc, initId, query)` | Dedup check |

### Formatting
| Function | Purpose |
|----------|---------|
| `formatCortexDocForAgent(doc)` | Full doc summary for agents |
| `formatResearchQuestionForAgent(question)` | Single question detail |
| `getResearchQuestionsSummary(doc)` | Quick status overview |

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
   ├─→ Generate questions
   ├─→ For each question:
   │       └─→ ResearchQuestion Agent loop (search → reason → ...)
   │       └─→ Save to DB after each step
   │       └─→ Emit SSE events
   ├─→ Evaluate after all complete
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
| `question_started` | `{ questionId, name, goal }` |
| `search_completed` | `{ questionId, query, answer, sources }` |
| `reasoning_completed` | `{ questionId, reasoning }` |
| `reflection_completed` | `{ questionId, learned, nextStep }` |
| `question_completed` | `{ questionId, confidence, recommendation }` |
| `synthesizing_started` | `{}` |
| `research_complete` | `{ totalResearchQuestions, totalFindings, confidence }` |

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
│   └── question-agent.ts       # Single question execution
├── types/
│   └── question-doc.ts         # Zod schemas + types
├── tools/
│   └── tavily-search.ts          # Web search (1 query max)
└── utils/
    └── question-operations.ts  # CortexDoc helpers

hooks/
└── useChatAgent.ts               # SSE + React state

components/chat/
├── ChatAgentView.tsx             # Main chat UI
└── ResearchProgress.tsx          # Tabbed question view

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
search(1) → must call reflect() → can search again
```

This ensures every search gets explicit reasoning (and a structured Episode delta) before proceeding.

### Why Full Context (No Truncation)?

**Problem:** Truncating history loses important context for decisions.

**Solution:** ResearchQuestion agents receive:
- ALL previous search results
- ALL previous reflections
- Full objective and sibling question list

**Note:** In production, we compact older history into Episodes and keep only the most recent detailed logs to prevent context bloat.

### Why Real-Time Saves?

**Problem:** Long research sessions risk losing progress.

**Solution:** Save to DB after every:
- Search completion
- Reasoning completion
- Reflection completion

User sees real-time progress. Crash recovery is automatic.

### Why Guardrails + Compaction?

**Problem:** Long-running sessions can bloat memory and exceed time/budget.

**Solution:** The orchestrator applies:
- **Compaction**: keep only the latest N search results / reflections / episodes per question.
- **Guardrails**: synthesize early when time/budget limits are hit.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** Neon PostgreSQL + Drizzle ORM
- **Auth:** Clerk
- **AI:** OpenAI gpt-5.1 (intake/cortex), gpt-5.1 (questions)
- **Search:** Tavily API
- **UI:** Tailwind + Framer Motion
