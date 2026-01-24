# Swarm11 System Overview

## Entities

The data structures that hold research state. Everything lives inside BrainDoc.

### BrainDoc

The "brain" - one JSON object that holds the entire research session. Stored in the database and updated after every step.

| Field | What it holds |
|-------|---------------|
| `objective` | The user's research goal, e.g. "Find podcast sponsors in tech" |
| `successCriteria[]` | How we know we're done, e.g. ["Find 5+ sponsors", "Include pricing"] |
| `status` | Where we are: `running` → `synthesizing` → `complete` |
| `questions[]` | The research questions being investigated |
| `brainLog[]` | Every decision Brain made (for debugging) |
| `finalAnswer` | The final synthesized answer shown to the user |

### ResearchQuestion

One angle of research. A BrainDoc has multiple questions running in parallel.

| Field | What it holds |
|-------|---------------|
| `id`, `name`, `question`, `goal` | Identity: "Podcast Networks" - "Which networks have biggest ad budgets?" - "List of 10+ networks" |
| `description` | Why this matters: "This will help us understand who the major players are..." |
| `status` | `pending` (waiting) → `running` (searching) → `done` (finished) |
| `cycles` | How many search→reflect loops we've done (max: 30) |
| `memory[]` | Simple message list: search, result, reflect entries |
| `document` | Structured output when done: answer, keyFindings, sources, limitations |
| `confidence` | How sure we are: `low` / `medium` / `high` |
| `recommendation` | Was this useful: `promising` / `dead_end` / `needs_more` |

### QuestionDocument

When a question completes, it produces a structured document that Brain uses for evaluation and synthesis.

| Field | What it holds |
|-------|---------------|
| `answer` | 2-3 paragraph comprehensive answer |
| `keyFindings[]` | Bullet points of main facts discovered |
| `sources[]` | URLs with title and what each contributed |
| `limitations` | What we couldn't find or verify |

---

## Flow

How a user message becomes a research answer. The system goes through these stages in order.

```
User Message
     │
     ▼
┌─────────────────────────────────────────────┐
│  INTAKE AGENT                               │
│  Clarifies: WHAT + WHY + SUCCESS            │
│  Only proceeds when all three are explicit  │
└─────────────────────────────────────────────┘
     │ start_research
     ▼
┌─────────────────────────────────────────────┐
│  MAIN LOOP                                  │
│  Creates BrainDoc, manages lifecycle        │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│  BRAIN AGENT: Generate Questions            │
│  Spawns 3 parallel research questions       │
└─────────────────────────────────────────────┘
     │
     ▼ (for each question)
┌─────────────────────────────────────────────┐
│  RESEARCHER AGENT                           │
│  search → reflect → ... → complete          │
│  Saves to DB after every step               │
└─────────────────────────────────────────────┘
     │ all questions done
     ▼
┌─────────────────────────────────────────────┐
│  BRAIN AGENT: Evaluate                      │
│  Check criteria coverage via episodes       │
│  → spawn_new (back to generate)             │
│  → synthesize (continue)                    │
└─────────────────────────────────────────────┘
     │ synthesize
     ▼
┌─────────────────────────────────────────────┐
│  BRAIN AGENT: Synthesize                    │
│  Combine findings into final answer         │
└─────────────────────────────────────────────┘
     │
     ▼
  Response
```

---

## Agents & Tools

Three AI agents that use LLMs and tools. Each one thinks and makes decisions.

### Intake Agent
**File:** `intake-agent.ts`

Talks to the user before research starts. Extracts WHAT they want, WHY they need it, and what SUCCESS looks like. Won't start research until all three are explicit.

| Tool | What it does |
|------|--------------|
| `decisionTool` | Returns one of: `text_input` (ask a question), `multi_choice_select` (offer options), or `start_research` (all clear, begin) |

---

### Brain Agent
**File:** `brain-agent.ts`

The strategic brain. Decides what questions to research, evaluates if we have enough, and writes the final answer.

**Philosophy:** Don't plan end-to-end. Start with big unknowns, explore, then decide where to dig deeper.

| Tool | What it does |
|------|--------------|
| `kickoff` | Explores biggest unknowns with 3 initial questions (not end-to-end planning) |
| `evaluate` | Reads ALL question documents, decides: `spawn_new` (need more research) or `synthesize` (we have enough) |
| `synthesize` | Combines all question documents into the final answer for the user |

---

### Researcher Agent
**File:** `researcher-agent.ts`

Executes one research question by searching the web and reflecting on what was learned.

**Context:** Sees BOTH the main objective AND its specific question. Also sees completed documents from prior questions (to build on, not duplicate).

| Tool | What it does |
|------|--------------|
| `search` | Runs a Tavily web search with one query, returns answer + sources |
| `reflect` | After each search, records: what changed (`progress`/`no_change`/`dead_end`), thought process, and whether to `continue` or mark `done` |
| `complete` | When done, generates QuestionDocument: answer, keyFindings, sources, limitations, confidence, recommendation |

**Workflow:** `search → reflect → search → reflect → ... → reflect(done) → complete`

---

## Main Loop

**File:** `main-loop.ts`

Not an agent - just code. The main loop that runs everything:

```
1. Call Intake Agent until user intent is clear
2. Create BrainDoc
3. Call Brain Agent to generate questions
4. For each question: call Researcher Agent
5. Call Brain Agent to evaluate
6. If "spawn_new" → back to step 3
7. If "synthesize" → call Brain Agent to write final answer
8. Done
```

Saves to database after every step. No LLM, no tools, just control flow.

---

## Key Handoffs

When control passes from one component to another.

| From | To | When |
|------|----|------|
| Intake | Main Loop | User's intent is clear, time to start research |
| Main Loop | Brain | Need to generate questions, evaluate progress, or write final answer |
| Main Loop | Researcher | A question is ready to run |
| Researcher | Main Loop | Question finished researching |
| Brain | Main Loop | Decided to spawn more questions or synthesize |

---

## Design Principles

Why we built it this way.

| Principle | What it means |
|-----------|---------------|
| **Inference-hostile intake** | Never guess what the user wants. If unclear, ask. |
| **Exploratory kickoff** | Don't plan end-to-end. Start with big unknowns, get a sense, then decide. |
| **Strict search→reflect** | Can't search twice in a row. Must reflect after each search to avoid blind chaining. |
| **Simple memory model** | Each question has one `memory[]` array: search, result, reflect entries. |
| **Document-based handoff** | Each question produces a QuestionDocument. Brain reads ALL documents to evaluate. |
| **Prior knowledge sharing** | New researchers see completed question documents to build on, not duplicate. |
| **Real-time persistence** | Save to database after every step. Crash = no lost work. User sees live progress. |
| **Iterative deepening** | Run questions, evaluate, spawn focused follow-ups. Can take 10-50+ rounds if needed. |
