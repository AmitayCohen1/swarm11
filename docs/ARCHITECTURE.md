# Swarm11 Architecture (Simple)

This repo is a **research chat app**: a user sends a message, we clarify intent, then we run a bounded research loop and stream progress to the UI.

## High-level flow

```
UI (SessionView)
  → POST /api/sessions/[id]/message  (SSE stream)
    → Intake Agent (clarify / options / start)
    → Research loop (brain decides questions; per-question researcher searches)
    → Persist BrainDoc to DB + stream updates
```

## What each piece does

- **UI**
  - `components/sessions/SessionView.tsx`: main chat UI.
  - `hooks/useSession.ts`: sends messages, parses SSE events, keeps `researchDoc` up to date.
  - `components/sessions/ResearchProgress.tsx`: renders the “BrainDoc” progress view (questions + memory).

- **API (the runtime “orchestrator”)**
  - `app/api/sessions/create/route.ts`: creates a `chat_sessions` row.
  - `app/api/sessions/[id]/message/route.ts`: the main “front door”:
    - validates auth (Clerk)
    - appends the user message to `chat_sessions.messages`
    - runs intake
    - if research starts: runs the research loop and streams SSE progress

- **Agents / loops (server-side)**
  - `lib/agents/intake-agent.ts` (**Intake**): returns exactly one of:
    - `text_input`: ask a clarifying question
    - `multi_choice_select`: offer 2–4 options
    - `start_research`: returns a `ResearchBrief { objective, successCriteria[] }`
    - Any decision may include `searchPerformed: { query, answer }` if intake looked something up
  - `lib/research/run.ts` (**Research loop**): manages rounds and persistence.
  - `lib/research/brain.ts` (**Brain**): decides “continue vs done” and proposes new questions; writes the final answer.
  - `lib/research/researcher.ts` (**Researcher**): runs a single question:
    - search → evaluate → reflect (repeat)
    - then summarize the question
  - `lib/research/search.ts` (**Search tool**): Perplexity Sonar wrapper.

## Data model (what’s stored)

- **`chat_sessions`** (`lib/db/schema.ts`)
  - `messages` (JSON): the chat transcript (user + assistant + metadata).
  - `brain` (text): serialized **BrainDoc JSON** used by `ResearchProgress`.
  - `status`: `active` | `researching` | `completed`.

- **`research_sessions`**
  - a per-run record: objective, status, finalAnswer, timestamps.

## BrainDoc (the one UI-facing document)

The UI reads `chat_sessions.brain` as JSON (“BrainDoc v1”). Conceptually it contains:

- **objective**: what we’re trying to answer.
- **questions[]**: each question’s status + “memory” (search/result/reflect entries).
- **brainLog[]**: the brain’s round-level decisions (“spawn” vs “synthesize”).
- **finalAnswer**: the final response after research completes.

## What’s important to know (current realities)

- **Bounded execution**
  - Research loop: max rounds + max wall time (in `lib/research/run.ts`).
  - Per question: min searches + max searches (in `lib/research/researcher.ts`).

- **Success criteria is collected, but not yet wired into BrainDoc**
  - Intake returns `successCriteria[]`.
  - The current BrainDoc adapter in `lib/research/run.ts` saves `successCriteria: []`.

- **Sources aren’t wired through to the progress UI yet**
  - `searchWeb()` returns `sources`, but the adapter currently stores `sources: []` in the BrainDoc memory.

## Tech stack (what actually runs)

- **Framework**: Next.js (App Router)
- **Auth**: Clerk
- **DB**: Postgres (Neon) + Drizzle
- **LLMs**:
  - Intake: Anthropic (`claude-sonnet-4-20250514`) via AI SDK
  - Brain + Researcher: OpenAI (`gpt-5.2`) via AI SDK
- **Search**: Perplexity (`sonar`) via `@ai-sdk/perplexity`
