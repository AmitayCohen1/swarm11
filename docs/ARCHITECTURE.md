# Swarm11 Architecture

A **research chat app**: user sends a message, we clarify intent, then run a tree-based research system and stream progress to the UI.

## High-level flow

```
UI (SessionView)
  → POST /api/sessions/[id]/message  (SSE stream)
    → Intake Agent (clarify / options / start)
    → Research (cortex orchestrates tree of researcher nodes)
    → Persist ResearchState to DB + stream updates
```

## What each piece does

- **UI**
  - `components/sessions/SessionView.tsx`: main chat UI.
  - `hooks/useSession.ts`: sends messages, parses SSE events, keeps `researchDoc` state.
  - `components/sessions/ResearchProgress.tsx`: renders the research tree (ReactFlow visualization).

- **API**
  - `app/api/sessions/[id]/message/route.ts`: main endpoint - validates auth, runs intake, starts research.
  - `app/api/tree-research/route.ts`: test endpoint for research system.

- **Research System** (`lib/research/`)
  - `types.ts`: **Single source of truth** for all types (ResearchState, ResearchNode, etc.)
  - `run.ts`: Entry point - connects research to DB and SSE streaming.
  - `runner.ts`: Event-driven orchestration loop.
  - `cortex.ts`: The "brain" - evaluates progress, decides what nodes to spawn.
  - `researcher.ts`: Executes a single node (search → reflect → answer).
  - `search.ts`: Perplexity Sonar wrapper.

## Data model

- **`chat_sessions`** (`lib/db/schema.ts`)
  - `messages` (JSON): chat transcript.
  - `brain` (text): serialized **ResearchState** JSON.
  - `status`: `active` | `researching` | `completed`.

## ResearchState (the core data structure)

```typescript
interface ResearchState {
  objective: string;
  successCriteria?: string[];
  status: 'running' | 'complete' | 'stopped';
  nodes: Record<string, ResearchNode>;  // Tree of research nodes
  finalAnswer?: string;
  decisions?: Decision[];  // Cortex decision history
}

interface ResearchNode {
  id: string;
  parentId: string | null;  // null = root node
  question: string;
  reason: string;  // Why this helps answer the objective
  status: 'pending' | 'running' | 'done';
  answer?: string;
  confidence?: 'low' | 'medium' | 'high';
  searches?: SearchEntry[];  // Search history for this node
  suggestedFollowups?: Followup[];
}
```

## Key design decisions

- **Tree structure**: Research forms a tree, not a flat list. Child nodes drill deeper into parent findings.
- **Event-driven**: Cortex reacts when ANY node completes (no batch waiting).
- **Single type system**: Same `ResearchState` used in backend, DB, and frontend.
- **Configurable limits**: `RESEARCH_LIMITS` in types.ts controls max nodes, depth, time.

## Tech stack

- **Framework**: Next.js (App Router)
- **Auth**: Clerk
- **DB**: Postgres (Neon) + Drizzle
- **LLMs**: OpenAI (configurable via `RESEARCH_MODEL` env var)
- **Search**: Perplexity (`sonar`)
