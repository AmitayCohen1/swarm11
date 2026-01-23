# Swarm11 - Autonomous Research Agent

An autonomous research agent using the **Cortex Architecture**: a three-tier system where an Intake Agent clarifies user intent, a Cortex Orchestrator manages parallel research questions, and ResearchQuestion Agents execute focused searches with enforced reasoning cycles.

## Architecture Overview

```
User Message
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  INTAKE AGENT (gpt-4.1)                                         │
│  - Clarifies intent (inference-hostile: asks, never guesses)    │
│  - Extracts objective + success criteria                        │
│  - Decides: respond / ask clarification / start research        │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ (start_research)
┌─────────────────────────────────────────────────────────────────┐
│  CORTEX ORCHESTRATOR                                            │
│  - Generates 3 parallel questions                             │
│  - Runs questions sequentially (v1)                           │
│  - Evaluates progress: continue / drill_down / spawn / synth    │
│  - Adversarial review before final synthesis                    │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼ (for each question)
┌─────────────────────────────────────────────────────────────────┐
│  INITIATIVE AGENT (gpt-4.1-mini)                                │
│  - One search query at a time                                   │
│  - Enforced: search → search_reasoning → search → ...           │
│  - Full context: overall objective + sibling questions        │
│  - Saves to DB after every search and reasoning                 │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Real-time UI via SSE (ResearchProgress component)
```

## ResearchQuestion Schema

Each research question has:

| Field | Purpose |
|-------|---------|
| `name` | Short label (e.g., "Market Analysis") |
| `description` | Why this angle matters |
| `goal` | What we're looking to achieve |
| `status` | `pending` / `running` / `done` |
| `findings` | Facts discovered (with sources) |
| `searchResults` | Full search history with reasoning |
| `reflections` | Cycle-level learnings |

## Key Design Principles

### 1. Inference-Hostile Intake

The intake agent is explicitly forbidden from guessing:
- If anything is unclear → ASK
- Friction is better than wrong research
- Only starts when objective, purpose, and success criteria are ALL clear

### 2. Search → Reason → Search Flow

Within each question, the agent MUST alternate:
```
search(1 query) → search_reasoning() → search(1 query) → search_reasoning() → ...
```

A state machine (`awaitingReasoning`) enforces this:
- After `search()`: only `search_reasoning` tool is available
- After `search_reasoning()`: all tools are available again

### 3. Full Context for ResearchQuestions

Each question agent receives:
- Overall research objective
- Success criteria for the whole research
- List of all sibling questions (so it knows its place)
- ALL previous search results (no truncation)
- ALL previous reflections

### 4. Real-Time Persistence

Every action saves immediately:
- Search completes → save to DB → emit SSE
- Reasoning completes → save to DB → emit SSE
- User sees progress in real-time

## File Structure

```
lib/
├── agents/
│   ├── intake-agent.ts           # Clarifies intent, creates research brief
│   ├── cortex-agent.ts           # Generates questions, evaluates, synthesizes
│   ├── cortex-orchestrator.ts    # Manages full research flow
│   └── question-agent.ts       # Executes one question (search/reason loop)
├── types/
│   └── question-doc.ts         # CortexDoc, ResearchQuestion, Finding schemas
├── tools/
│   └── tavily-search.ts          # Web search (max 1 query at a time)
└── utils/
    └── question-operations.ts  # CortexDoc manipulation helpers

hooks/
└── useChatAgent.ts               # React hook for SSE + state management

components/chat/
├── ChatAgentView.tsx             # Main chat UI
└── ResearchProgress.tsx          # Real-time question progress (tabbed)

app/api/chat/
├── start/route.ts                # Create session
├── [id]/message/route.ts         # Send message (SSE stream)
└── [id]/stop/route.ts            # Stop research
```

## CortexDoc Structure

The brain is stored as a `CortexDoc` JSON:

```typescript
{
  version: 1,
  objective: string,              // What we're researching
  successCriteria: string[],      // How we know we're done
  status: 'running' | 'synthesizing' | 'complete',
  questions: ResearchQuestion[],       // Parallel research angles
  cortexLog: CortexDecision[],    // Orchestrator decisions
  finalAnswer?: string            // Final synthesis
}
```

Each `ResearchQuestion`:
```typescript
{
  id: string,
  name: string,                   // Short label
  description: string,            // Why this matters
  goal: string,                   // What we're looking for
  status: 'pending' | 'running' | 'done',
  cycles: number,
  maxCycles: number,
  findings: Finding[],            // Facts with sources
  searchResults: SearchResult[],  // Full search history
  reflections: CycleReflection[], // Cycle learnings
  confidence: 'low' | 'medium' | 'high' | null,
  recommendation: 'promising' | 'dead_end' | 'needs_more' | null,
  summary?: string
}
```

## SSE Event Types

```typescript
type EventType =
  | 'cortex_initialized'      // CortexDoc created
  | 'question_started'      // Beginning an question
  | 'search_completed'        // Search results received
  | 'reasoning_completed'     // Post-search reasoning done
  | 'reflection_completed'    // Cycle reflection done
  | 'question_completed'    // ResearchQuestion finished
  | 'review_started'          // Adversarial review beginning
  | 'review_completed'        // Review verdict
  | 'synthesizing_started'    // Writing final answer
  | 'research_complete'       // All done
  | 'doc_updated'             // CortexDoc changed (triggers save)
  | 'brain_update'            // Brain saved to DB
  | 'message'                 // Chat message
  | 'error';                  // Error occurred
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
OPENAI_API_KEY=sk-...          # For all agents

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
| AI | AI SDK, GPT-4.1 (intake/cortex), GPT-4.1-mini (questions) |
| Search | Tavily AI |
| Database | Neon PostgreSQL + Drizzle |
| Auth | Clerk |
| Styling | Tailwind CSS |

## Links

- [AI SDK Docs](https://ai-sdk.dev)
- [Tavily API](https://tavily.com)
- [Neon](https://neon.tech)
- [Clerk](https://clerk.com)

## License

MIT
