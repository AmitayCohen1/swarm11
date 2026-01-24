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
| `id`, `name`, `goal` | Identity: "Podcast Networks" - "Find who hosts tech podcasts" |
| `status` | `pending` (waiting) → `running` (searching) → `done` (finished) |
| `cycles` | How many search→reflect loops we've done |
| `searches[]` | Every search: query, answer, and source URLs |
| `episodes[]` | Structured memory: what changed, what's next (see below) |
| `findings[]` | Facts we extracted, with sources |
| `confidence` | How sure we are: `low` / `medium` / `high` |
| `recommendation` | Was this useful: `promising` / `dead_end` / `needs_more` |

### Episode

A single search→reflect cycle, stored as structured data. This is what Brain looks at to decide if we need more research.

| Field | What it holds |
|-------|---------------|
| `cycle`, `query` | Which cycle number and what we searched |
| `deltaType` | Did we learn something: `progress` / `no_change` / `dead_end` |
| `nextStep` | What we plan to do next |
| `status` | Keep going (`continue`) or stop (`done`) |

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

| Tool | What it does |
|------|--------------|
| `create_question` | Creates a new research question with name, goal, max cycles, and optional strategy |
| `evaluate` | After questions complete, decides: `spawn_new` (need more research) or `synthesize` (we have enough) |
| `synthesize` | Combines all findings into the final answer for the user |

---

### Researcher Agent
**File:** `researcher-agent.ts`

Executes one research question by searching the web and reflecting on what was learned.

| Tool | What it does |
|------|--------------|
| `search` | Runs a Tavily web search with one query, returns answer + sources |
| `reflect` | After each search, records: what changed (`progress`/`no_change`/`dead_end`), what to do next, and whether to `continue` or mark `done` |
| `complete` | When done researching, generates final summary, confidence level, and recommendation for this question |

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
| **Strict search→reflect** | Can't search twice in a row. Must reflect after each search to avoid blind chaining. |
| **Episode-based memory** | Each search cycle creates a structured Episode. Brain reads these to decide if we're done. |
| **Real-time persistence** | Save to database after every step. Crash = no lost work. User sees live progress. |
| **Wave parallelism** | Run multiple questions at once, then evaluate as a batch. Repeat until done. |
