# Prompts: Roles, Intent, and Pitfalls (Swarm11)

This document describes **what each LLM role is responsible for**, what’s important to communicate in its prompt, and **common failure modes** to watch for.  
It intentionally **does not** include the literal prompt strings.

---

### Cross-cutting principles (apply to all roles)

- **Stay tied to the main objective**: every step should answer “how does this move us closer to the objective?”
- **Prefer narrow + testable** over broad + hand-wavy: vague questions create drift and generic output.
- **Self-contained**: don’t assume hidden context; restate necessary scope (segment/timeframe/geo) in the question/task.
- **One thing at a time**: avoid multi-part questions; if it’s two asks, split into two questions.
- **Schema alignment**: if code parses JSON (Zod), ensure the prompt explicitly matches the keys/shape.

---

### Intake (Gatekeeper)

- **Role**
  - Turn user intent into a **Research Brief**: a clear objective + success criteria.
  - Ask **at most one** clarifying question per turn when needed.
  - Optionally do a quick web lookup for unfamiliar terms (basic context only).

- **What matters in the prompt**
  - **Definition of “enough info”**: what must be known before research starts (scope/timeframe/audience/output).
  - **Tool discipline**: must respond via exactly one tool call.
  - **Shortness**: keep questions 1–2 sentences.

- **Common pitfalls**
  - Asking multiple questions in one turn.
  - Starting research with a vague objective (“learn about X”).
  - Using web search as a crutch instead of asking the user for missing constraints.

---

### Brain.evaluate (Planner)

- **Role**
  - Decide **continue vs done** based on completed research.
  - If continuing, propose the **next 1–3 research questions/tasks** that best reduce remaining uncertainty.

- **What matters in the prompt**
  - **Selection strategy**: pick the next moves that most increase confidence in the objective.
  - **Question quality**: questions should be:
    - **Tight** (one unknown)
    - **Answerable** (can be supported by web evidence)
    - **Comparable** (scoped enough that answers don’t mix apples/oranges)
  - **Justification**: each question should carry a short “why this helps objective” explanation.

- **Common pitfalls**
  - **Compound questions** (“who buys X and what budgets and triggers exist?”) → drift.
  - **Assumed frameworks** (“do TAM/SAM/SOM for each segment”) → not self-contained.
  - **Search-query questions** (e.g., `site:linkedin.com ...`) → you want *research questions*, not Google syntax.
  - Overly broad prompts that produce generic “consulting” answers.

---

### Brain.finish (Synthesizer)

- **Role**
  - Produce the **final user-facing answer** from the completed research summaries.

- **What matters in the prompt**
  - **Directness**: answer the objective first, then support.
  - **Criteria check**: explicitly confirm which success criteria are satisfied; state what’s missing if not.
  - **Groundedness**: synthesize using only the provided findings (don’t invent).

- **Common pitfalls**
  - Meta commentary instead of an answer.
  - Hallucinating missing facts or claiming certainty without evidence.
  - Ignoring success criteria.

---

### Researcher.evaluate (Web-search loop controller)

- **Role**
  - For one sub-question, decide **continue vs done** and propose the **next web query**.

- **What matters in the prompt**
  - **Evidence-gap thinking**: “what’s the single missing piece blocking a confident answer?”
  - **Query quality**: short, specific keywords; aim at the missing evidence.
  - **Stop condition**: “done” when the sub-question can be answered with concrete facts + remaining gaps.

- **Common pitfalls**
  - Vague queries (“learn more about…”) → low signal.
  - “AND chains” or long sentences → poor retrieval.
  - Looping without progress (repeating near-duplicates).

---

### Researcher.finish (Sub-question summarizer)

- **Role**
  - Turn the sub-question’s search history into:
    - a clear **summary** and
    - a **confidence** level.

- **What matters in the prompt**
  - **Concrete output**: names/dates/numbers when present; call out gaps.
  - **No filler**: avoid generic phrasing when evidence is thin.
  - **Format discipline**: if the system parses JSON, the model must not embed raw JSON inside the summary text.

- **Common pitfalls**
  - Returning an “answer” that is actually a JSON blob (model puts JSON inside a string).
  - Overconfidence without evidence.

---

### Search (Perplexity wrapper)

- **Role**
  - Execute one web query and return:
    - an **answer** and
    - **sources** (citations/URLs).

- **What matters in the prompt**
  - **High signal first**: bullets first, then short supporting details.
  - **Citations**: ensure the selected model reliably returns `sources`; otherwise UI will show none.

- **Common pitfalls**
  - Using a model that returns empty `sources` frequently → citations don’t show in UI.
  - Returning long, vague paragraphs without concrete details.

---

### Operational checklist when something “drifts”

- **If Brain questions are bad**:
  - Are they compound? too broad? assuming context?
  - Are they framed as search queries instead of research questions?

- **If Researcher answers are garbage**:
  - Are queries too vague?
  - Is the loop repeating near-duplicate searches?

- **If UI sources don’t show**:
  - Did the search model return `sources`?
  - Are sources being saved into question history and mapped into the frontend doc?

