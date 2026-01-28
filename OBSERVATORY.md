# Observatory

**System-Prompt-Driven Agent Quality Monitoring**

## What It Is

Observatory tracks LLM calls per “agent”, then evaluates those calls against **metrics** derived from the agent’s **prompt instructions**.

## Problem

Teams write system prompts, but can't tell if agents actually follow them or if changes improve behavior.

## Solution

Observatory:

- **Discovers metrics** by reading the agent’s stored prompt text and extracting explicit rules (“must/never/avoid/always…”).
- **Scores calls** 0–10 per metric (plus `overall`) and stores evaluations in the DB.
- **Surfaces suggestions** in the admin UI so you can accept/edit metrics and track trends over time.

## How It Works

1. **Track calls** (`lib/eval/trackLlmCall`)
   - Every agent call should store:
     - `systemPrompt` (or equivalent “instruction prompt” text)
     - `input`
     - `output`
2. **Evaluation trigger**
   - When an agent has \(N\) unevaluated calls (default 3), the evaluator runs.
3. **Two evaluation modes** (`lib/eval/index.ts`)
   - **Metric discovery (when agent has no metrics yet)**:
     - Reads the prompt instructions and proposes `suggestedMetrics`.
     - Stores those suggestions on the evaluation record (UI can “Add” them).
   - **Scoring (when agent has metrics)**:
     - Produces `scores` per metric and `overall`, plus short `reasoning` + `insights`.
4. **Visualize** (`/admin/observatory`)

## Value

- **Measure prompt impact** - Did that change help?
- **Catch regressions** - Are things getting worse?
- **Debug specific instructions** - Which rule is failing?

## Common “why isn’t it working?” gotchas

- **Agent not registered**: calls are only stored for agents that exist in the `agents` table (created via `/admin/observatory`).
- **No metrics yet**: first runs only produce *suggested* metrics. You need to add them (or let auto-apply happen) before per-metric scoring starts.
- **Prompt text is missing/incorrect**: metric discovery depends on `systemPrompt` (or stored prompt text) containing the actual behavioral rules.
- **Non-JSON eval output**: the evaluator must return strict JSON; otherwise parsing fails and you’ll see empty/zero scores.

---

*Observatory turns prompts into rules, rules into scores, and scores into insight.*
