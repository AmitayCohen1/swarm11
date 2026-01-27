# Quality Contracts: Roles, Scorecards, and Gates (Swarm11)

This document defines the **underlying behavior** (contract) expected from each component in Swarm11’s autonomous research loop.

The goal is to prevent **vagueness drift** from compounding across layers by making “good output” **explicit and checkable** at the point it’s produced.

This is intentionally **non-technical**: it describes roles, scope, expected outputs, and quality gates—no implementation details.

---
## Cross-cutting contract (applies to all roles)

Every component must be able to answer:

- **Role boundary**: what it can/can’t do (e.g., Brain plans; it doesn’t search).
- **Scope**: what context it is allowed to use.
- **Output discipline**: schema/tool-call correctness.
- **Quality scorecard**: what “good” means for this role.
- **Gate**: when output is considered acceptable vs needs revision.

Definitions used throughout:

- **Objective**: the user-facing goal (from Intake).
- **Sub-question**: a single research task delegated by Brain.
- **Evidence**: concrete facts with citations (names/dates/numbers/quotes/links).
- **Novelty**: whether new evidence was added vs rephrased narrative.

---

## Component contracts

### Intake (Gatekeeper)

- **Purpose**: Turn user intent into a crisp **ResearchBrief** or ask for missing constraints.
- **Inputs (allowed)**:
  - User message + conversation history
  - Optional *one* quick web lookup for unfamiliar terms only
- **Outputs (must be exactly one tool call)**:
  - `textInput` (one clarifying question) OR
  - `multiChoiceSelect` (2–4 options) OR
  - `startResearch` with `objective` + `successCriteria[]`

#### Intake scorecard (must satisfy before `startResearch`)

- **Objective is single-sentence and concrete** (no “learn about…”, “explore…”).
- **Ambiguity resolved**: if multiple plausible interpretations exist, ask one question.
- **Constraints captured** (when relevant): timeframe, geography, audience, output format.
- **Success criteria are checkable** (1–4 verifiable conditions, not vibes).

#### Intake gates (when to block)

- If the objective is underspecified in a way that will force guessing downstream, **do not** start research.
- If the user’s intent could reasonably mean two different tasks, **do not** infer—ask.

#### Observability (what we should be able to see)

- The chosen decision type and its reasoning.
- If an intake search occurs: the query and a short summary (plus citations if available).

---

### Brain.evaluate (Planner)

- **Purpose**: Decide **continue vs done** and propose the next best 1–3 sub-questions.
- **Inputs (allowed)**:
  - Objective + success criteria
  - Completed sub-question summaries (not raw search results)
- **Outputs**:
  - `decision: continue|done`
  - `questions[]`: up to 3 `{ question, description, goal }`

#### Brain.evaluate scorecard (for each proposed sub-question)

- **Single-unknown**: the question asks for ONE thing (no “and/also” bundles).
- **Standalone**: includes enough context to be answerable without hidden assumptions.
- **Evidence-aimed**: can be resolved with web evidence (not purely opinion).
- **Goal defines “good evidence”**: the `goal` states what a good answer includes (and ideally the evidence type).
- **Direct contribution**: `description` explicitly states how it advances the objective.

#### Brain.evaluate gates (when to block)

- If a proposed question is basically a *search query* or includes search operators/keyword soup, rewrite.
- If a proposed question is broad exploration, rewrite into the **next missing evidence** needed.

#### Observability

- For each brain round: decision + rationale + what questions were spawned and why.

---

### Researcher.evaluate (Web-search loop controller) — **the key choke point**

- **Purpose**: For a single sub-question, decide **continue vs done** and produce the **next query**.
- **Inputs (allowed)**:
  - Objective, sub-question, goal
  - Search history: queries + returned answers + citations
- **Outputs (today)**:
  - `decision: continue|done`
  - `query: string`
  - `reasoning: string`

#### Researcher.evaluate scorecard (every cycle)

- **Missing piece explicitly named**: “The one missing evidence piece is: …”
- **Query specificity**:
  - Includes the **entity** + the **missing attribute** + a scope token when needed (timeframe/geo/role/version).
  - Natural-language query (not Boolean/keyword soup).
- **Novelty**: query is not a near-duplicate of previous queries.
- **Evidence delta**: the last result either:
  - added a concrete fact/citation that materially advances the goal (**progress**), or
  - did not (**no_change/dead_end**).
- **Stop discipline**:
  - If diminishing returns (e.g., repeated “no_change”), stop and summarize what’s missing.

#### Researcher.evaluate gates (when to block)

- If the proposed query is vague (“more about…”, “learn about…”) → reject and require it to encode the missing piece.
- If the query omits key scope variables that are clearly needed for comparability → reject.
- If the query repeats prior queries (semantic duplicate) → reject.

#### Observability

- For each cycle: query → result (with sources) → evaluation decision and why.
- We should be able to compute:
  - duplicate-query rate
  - no-change streaks
  - average time/searches to “done” per question

---

### Search (The Eyes / Retrieval Primitive)

- **Purpose**: Execute ONE web query and return **high-signal evidence** with citations.
- **Inputs**:
  - A single query string
- **Outputs (today)**:
  - `answer: string`
  - `sources: [{ title, url }]`

#### Search scorecard

- **Evidence-first**: first ~600 chars contain dense bullets of concrete facts (when available).
- **Citations**: sources are present; key claims should be attributable.
- **Ambiguity handling**:
  - If the query is ambiguous, surface the ambiguity (don’t hallucinate specificity).
  - Prefer returning “insufficient specificity” + the minimal disambiguation needed.

#### Search gates (when to block)

- If sources are missing/empty, retry or downgrade confidence.
- If the answer is generic narrative without evidence, treat as low value for the next cycle.

#### Observability

- Sources count and domain diversity.
- Whether the answer contains concrete facts (names/dates/numbers) vs narrative.

---

## A minimal shared rubric vocabulary (recommended)

To keep prompts consistent across roles, use a shared set of labels:

- **Specificity**: low | medium | high
- **Evidence delta**: progress | no_change | dead_end
- **Novelty**: new | duplicate | near_duplicate
- **Grounding**: cited | weakly_cited | uncited

These labels can exist purely in prompts at first, then be promoted into structured fields when implementing gates.

---

## What to do next (process)

Recommended order of operations:

1. **Align on this contract** (edit this doc until it matches your expectations).
2. Update prompts to include the role scorecards + “gate” language (no schema changes yet).
3. Promote the rubric into **structured outputs** (especially `Researcher.evaluate`) so it becomes measurable.
4. Add hard gates (e.g., reject vague queries; block duplicates) once you can observe the rubric reliably.

