# Swarm11 Brain Architecture

## Overview

A three-tier autonomous research system:

```
User → Intake Agent → Main Loop → Researcher Agents → Web Search
                              ↓
                    BrainDoc (Brain/Memory)
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

### 2. Main Loop (`lib/agents/main-loop.ts`)

**Purpose:** Manage the full research lifecycle.

**Phases:**

```
PHASE 1: Initialize BrainDoc
    ↓
PHASE 2: Research Loop
    │
    ├─→ Brain evaluates (handles kickoff if no questions yet)
    │       ↓
    │   Decision: spawn_new / synthesize
    │       ↓
    ├─→ Run pending questions to completion
    │       ↓
    │   Researcher Agent loop
    │       ↓
    └─→ Loop back to Brain evaluation
    ↓
PHASE 3: Synthesize Final Answer
```

**Evaluation Decisions:**
| Action | When |
|--------|------|
| `spawn_new` | Gap identified, spawns 1-3 new questions in parallel |
| `synthesize` | Sufficient evidence gathered |

**Real-Time Saves:**
Every `doc_updated` event triggers immediate DB persistence.

---

### 3. Researcher Agent (`lib/agents/researcher-agent.ts`)

**Purpose:** Execute one research question with a disciplined loop and simple memory.

**Strict Tool Flow:**
```
search(1 query) → reflect() → search(1 query) → reflect() → ... → complete()
```

After each `search`, the agent must call `reflect` before it can search again.
When done, agent calls `complete` to generate a structured document.

**Available Tools:**

| Tool | Purpose | When Available |
|------|---------|----------------|
| `search` | Execute web search (1 query max) | When NOT awaiting reflection |
| `reflect` | Record natural language reflection | REQUIRED after every search |
| `complete` | Generate structured QuestionDocument | After reflect returns status=done |

**Context:**
- Sees BOTH the main objective AND its specific question/goal
- Sees completed question documents from prior research rounds (to build on, not duplicate)

**Memory Model:**
Each step appends to the question's `memory` array:
- `{ type: 'search', query: "..." }` - what we searched
- `{ type: 'result', answer: "...", sources: [...] }` - what we found
- `{ type: 'reflect', thought: "...", delta: "progress" }` - what we think

---

### 4. Brain Agent (`lib/agents/brain-agent.ts`)

**Purpose:** Higher-level reasoning functions.

**Philosophy:**
- Kickoff is exploratory, NOT end-to-end planning
- Start with big unknowns, get a sense of the landscape
- Each round builds on prior findings via question documents
- Brain sees ALL completed question documents when evaluating

**Functions:**
| Function | Purpose |
|----------|---------|
| `evaluateResearchQuestions()` | Evaluate state and decide next action. Handles kickoff (if no questions, generates initial exploratory questions) and subsequent evaluations. |
| `synthesizeFinalAnswer()` | Combine all question documents into final answer |

---

## Data Structures

### BrainDoc (Brain)

Stored as JSON in `chat_sessions.brain`:

```typescript
interface BrainDoc {
  version: 1;
  objective: string;
  successCriteria: string[];
  researchRound: number;           // Current research round
  researchStrategy?: string;       // Brain's initial thinking
  status: 'running' | 'synthesizing' | 'complete';
  questions: ResearchQuestion[];
  brainLog: BrainDecision[];       // Brain's decisions
  finalAnswer?: string;
}
```

### ResearchQuestion

```typescript
interface ResearchQuestion {
  id: string;                      // e.g., "q_1234_abc123"
  researchRound: number;           // Which round this belongs to
  name: string;                    // Short label: "Market Analysis"
  question: string;                // The research question
  description?: string;            // Why this matters / context
  goal: string;                    // What we're looking for
  status: 'pending' | 'running' | 'done';
  cycles: number;
  maxCycles: number;               // Default: 30
  memory: MemoryEntry[];           // Simple message list
  confidence: 'low' | 'medium' | 'high' | null;
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null;
  summary?: string;                // Legacy: short summary
  document?: QuestionDocument;     // Structured output when done
}
```

### QuestionDocument

```typescript
interface QuestionDocument {
  answer: string;                  // 2-3 paragraph comprehensive answer
  keyFindings: string[];           // Bullet points of main facts
  sources: {
    url: string;
    title: string;
    contribution: string;          // What this source contributed
  }[];
  limitations?: string;            // What we couldn't find
}
```

### MemoryEntry (Simple Message List)

```typescript
type MemoryEntry =
  | { type: 'search'; query: string }
  | { type: 'result'; answer: string; sources: { url: string; title?: string }[] }
  | { type: 'reflect'; thought: string; delta?: 'progress' | 'no_change' | 'dead_end' }
```

This is the core of the simplified memory model - just a list of messages.

### BrainDecision

```typescript
interface BrainDecision {
  id: string;
  timestamp: string;
  action: 'spawn' | 'synthesize';
  questionId?: string;
  reasoning: string;
}
```

---

## Memory Operations (`lib/utils/question-operations.ts`)

### Document Operations
| Function | Purpose |
|----------|---------|
| `initializeBrainDoc(objective, criteria)` | Create new BrainDoc |
| `serializeBrainDoc(doc)` | JSON.stringify for storage |
| `parseBrainDoc(json)` | Parse and validate |

### ResearchQuestion Operations
| Function | Purpose |
|----------|---------|
| `addResearchQuestion(doc, name, question, goal)` | Add new question |
| `startResearchQuestion(doc, id)` | Set status to running |
| `completeResearchQuestion(doc, id, summary, confidence, rec)` | Mark done |
| `incrementResearchRound(doc)` | Bump round counter |

### Memory Operations
| Function | Purpose |
|----------|---------|
| `addSearchToMemory(doc, questionId, query)` | Add search entry |
| `addResultToMemory(doc, questionId, answer, sources)` | Add result entry |
| `addReflectToMemory(doc, questionId, thought, delta)` | Add reflect entry |
| `getSearchQueries(doc, questionId)` | Get all queries from memory |
| `hasQueryBeenSearched(doc, questionId, query)` | Dedup check |

### Formatting
| Function | Purpose |
|----------|---------|
| `formatBrainDocForAgent(doc)` | Full doc summary for agents |
| `formatResearchQuestionForAgent(question)` | Single question detail |
| `getResearchQuestionsSummary(doc)` | Quick status overview |

---

## Database

### `chat_sessions` table
| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Session ID |
| `messages` | jsonb | Conversation history |
| `brain` | text | BrainDoc JSON |
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
2. POST /api/sessions/[id]/message (SSE stream)
   ↓
3. Intake Agent analyzes
   ├─→ Ask clarification → return question
   └─→ Start research → continue
   ↓
4. Main Loop
   ├─→ Initialize BrainDoc
   ├─→ Kickoff: explore big unknowns with 3 questions
   ├─→ For each question in batch:
   │       └─→ Researcher Agent loop (search → reflect → ... → done)
   │       └─→ Researcher sees prior completed docs (builds on, not duplicates)
   │       └─→ Append to memory after each step
   │       └─→ Summarize findings when loop ends
   │       └─→ Emit SSE events
   ├─→ After batch complete: Brain evaluates (sees all question documents)
   │       └─→ spawn_new: add 1-3 focused follow-up questions
   │       └─→ synthesize: enough evidence gathered
   ├─→ Loop continues with new batch until synthesize
   └─→ Synthesize final answer from all question documents
   ↓
5. Stream final answer to UI
```

---

## SSE Events

### Research Lifecycle
| Event | Data |
|-------|------|
| `brain_initialized` | `{ objective, successCriteria, version }` |
| `brain_strategy` | `{ strategy }` |
| `question_started` | `{ questionId, name, goal }` |
| `question_search_completed` | `{ questionId, queries }` |
| `question_reflection` | `{ questionId, thought, delta }` |
| `question_completed` | `{ questionId, confidence, recommendation }` |
| `synthesizing_started` | `{}` |
| `research_complete` | `{ totalResearchQuestions, totalMemory, confidence }` |

### State Updates
| Event | Data |
|-------|------|
| `doc_updated` | `{ doc }` (full BrainDoc) |
| `brain_update` | `{ brain }` (serialized JSON) |

---

## Constraints

| Constraint | Default | Env Var |
|------------|---------|---------|
| Max Eval Rounds | 50 | `BRAIN_MAX_EVAL_ROUNDS` |
| Max Wall Time | 15 min | `BRAIN_MAX_WALL_TIME_MS` |
| Max Credits | 1000 | `BRAIN_MAX_CREDITS_BUDGET` |
| Max Iterations/Question | 30 | hardcoded |
| Max Cycles/Question | 30 | hardcoded |
| Min Searches Before Done | 4 | hardcoded (enforced silently, not in prompt) |

When guardrails are hit, research gracefully synthesizes with available evidence.

---

## Key Files

```
lib/
├── agents/
│   ├── intake-agent.ts           # Intent clarification
│   ├── brain-agent.ts            # Generate/evaluate/synthesize
│   ├── main-loop.ts              # Full flow management
│   └── researcher-agent.ts       # Single question execution
├── types/
│   └── research-question.ts      # Zod schemas + types
├── tools/
│   └── tavily-search.ts          # Web search (1 query max)
└── utils/
    └── question-operations.ts    # BrainDoc helpers

hooks/
└── useSession.ts                 # SSE + React state

components/sessions/
├── SessionView.tsx               # Main session UI
└── ResearchProgress.tsx          # Research progress view
```

---

## Memory & Context Per Component

### Brain: Generate Questions (Kickoff)

**Receives:**
```
- objective (string)
```

**Does NOT receive:**
- Success criteria (intentionally omitted - explore first)
- Any prior research

**Purpose:** Explore the biggest unknowns without bias from criteria.

---

### Brain: Evaluate Questions

**Receives:**
```
- objective
- successCriteria[]
- Full BrainDoc state:
  - All questions with status
  - Each question's document (answer, keyFindings, sources, limitations)
  - Brain decision log
- Summary of completed vs running vs pending
```

**Context window:** Sees ALL completed research to make informed decisions.

---

### Brain: Synthesize Final Answer

**Receives:**
```
- objective
- successCriteria[]
- All completed question documents:
  - question.name
  - question.question
  - question.document.answer
  - question.document.keyFindings
  - question.document.sources (top 3)
  - question.document.limitations
  - question.confidence
```

**Purpose:** Combine all findings into coherent final answer.

---

### Researcher: Search Step

**Receives:**
```
- currentQuestion.question
- currentQuestion.goal
- searchHistory (this question's previous searches + results)
- previousQueries (list of queries to avoid repeating)
```

**Important:** Each researcher is ISOLATED - no sibling context, no prior knowledge. Fully focused on its own question.

---

### Researcher: Reflect Step

**Receives:**
```
- Last search query
- Last search result (answer + sources)
- currentQuestion.question
- currentQuestion.goal
- objective
- queriesExecuted.length (count of searches so far)
```

**Does NOT receive:**
- Full search history (only last search)
- Sibling questions

**Purpose:** Decide if last search helped, what to do next.

---

### Researcher: Complete Step (Summarize)

**Receives:**
```
- currentQuestion.question
- currentQuestion.goal
- objective
- Full searchHistory array:
  - Each: { query, answer (truncated), sources }
```

**Purpose:** Generate comprehensive markdown summary of findings.

---

## Context Isolation

| Component | Sees Other Questions? | Sees Prior Rounds? |
|-----------|----------------------|-------------------|
| Brain (kickoff) | No | No |
| Brain (evaluate) | Yes (all) | Yes (all docs) |
| Brain (synthesize) | Yes (all completed) | Yes (all docs) |
| Researcher (search) | No | No |
| Researcher (reflect) | No | No |
| Researcher (complete) | No | No |

**Key principle:** Researchers are FULLY ISOLATED. Only the Brain sees the big picture.

---

## Design Decisions

### Why Simple Memory Model?

**Before:** 4 overlapping arrays per question:
- `searches` - query + result
- `episodes` - structured deltas
- `reflections` - what was learned
- `findings` - curated facts

**After:** 1 simple array:
- `memory` - just messages: search, result, reflect

**Benefits:**
- One source of truth
- Easier to understand
- Less duplication
- Brain reads a conversation, not structured data

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

This ensures every search gets explicit reasoning before proceeding.

### Why Real-Time Saves?

**Problem:** Long research sessions risk losing progress.

**Solution:** Save to DB after every:
- Search completion
- Reflection completion

User sees real-time progress. Crash recovery is automatic.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** Neon PostgreSQL + Drizzle ORM
- **Auth:** Clerk
- **AI:** OpenAI gpt-5.2 (intake/brain/researcher)
- **Search:** Tavily API
- **UI:** Tailwind + Framer Motion
