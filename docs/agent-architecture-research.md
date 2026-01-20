# Cutting-Edge AI Agent Architecture Research

> Summary of patterns from Claude Code SDK, Manus AI, Vercel AI SDK 6, and Tavily
> Research Date: January 2026

---

## 1. Memory Architecture

### The Problem
Most agents only store "findings" - they forget what queries they ran, what failed, and what hypotheses were tested.

### Cutting-Edge Pattern: Hierarchical Memory

```
┌─────────────────────────────────────────┐
│ Working Memory (Current Step)           │  Full tool calls + results
├─────────────────────────────────────────┤
│ Episode Memory (Session Summary)        │  Compressed with timestamps
├─────────────────────────────────────────┤
│ Semantic Memory (Long-term Knowledge)   │  Key facts, entities, relationships
└─────────────────────────────────────────┘
```

### Key Insights

| Source | Pattern |
|--------|---------|
| **Manus AI** | "Memory Distillation" - completed segments compressed to summaries |
| **Claude Code** | Auto-compaction at 95% capacity, configurable threshold |
| **Best Practice** | Store: queries + findings + dead-ends + hypotheses tested |

### Implementation

```typescript
interface Episode {
  timestamp: string;
  queries: { query: string; purpose: string }[];
  findings: string;
  hypothesesTested: string[];
  deadEnds: string[];           // What NOT to try again
  queriesNotToRepeat: string[]; // Prevent duplicate searches
  confidence: number;
}
```

---

## 2. Agent Loop Structure

### Basic Loop (Most Agents)
```
search → process → search → process → stop
```

### Advanced Loop (Manus AI / Claude Code)
```
OBSERVE → THINK → ACT → REFLECT → [checkpoint] → loop
                              ↓
                    [on failure: rollback]
```

### Key Additions

| Feature | Description | Source |
|---------|-------------|--------|
| **Checkpointing** | Save state at milestones | Claude Code (`Esc+Esc` rewind) |
| **Rollback** | Return to previous checkpoint | Manus AI |
| **Goal Stack** | Hierarchical objectives | Manus AI |
| **Self-correction** | Retry with different approach on failure | All |

### Turn Limiting (Production Safety)

```bash
# Claude Code pattern
--max-turns 10        # Hard iteration limit
--max-budget-usd 5.00 # Cost ceiling
```

---

## 3. Tool Approval Patterns

### Vercel AI SDK 6 Three-Tier Approach

```typescript
const agent = new ToolLoopAgent({
  tools: {
    search: tool({
      needsApproval: false,  // Auto-execute (safe operations)
    }),
    deleteFile: tool({
      needsApproval: true,   // Always ask (destructive)
    }),
    runCode: tool({
      needsApproval: (input) => input.code.includes('rm'),  // Conditional
    }),
  },
});
```

### Claude Code Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Interactive prompts |
| `plan` | Review before execution |
| `skip` | Fully autonomous (no prompts) |

### Tool Sandboxing

```bash
# Fine-grained pattern matching
claude --allowedTools "Bash(git log:*)" "Bash(git diff:*)" "Read"
# Allows git log and git diff, but NOT git push
```

---

## 4. Multi-Agent Architecture

### Subagent Pattern (Claude Code)

```
┌─────────────────────────────────────┐
│ Orchestrator (decision maker)        │
│   ├── Explore Agent (Haiku)          │  Fast, read-only, cheap
│   ├── Research Agent (Sonnet)        │  Deep analysis
│   ├── Execute Agent (Opus)           │  Complex reasoning
│   └── Review Agent (Sonnet)          │  Validation
└─────────────────────────────────────┘
```

### Key Principle: Context Isolation
- Each subagent has **independent context window**
- Verbose output stays in subagent
- Only summary returns to orchestrator
- Prevents context pollution

### Orchestration Patterns

| Pattern | Use Case |
|---------|----------|
| **Sequential Chaining** | A → B → C (hand-off results) |
| **Parallel Research** | Spawn multiple agents concurrently |
| **Context Isolation** | Run verbose ops in subagent, return summary |

---

## 5. Model Selection Strategy

### Hybrid Model Pattern (Claude Code `opusplan`)

```
PLANNING PHASE  →  Opus (complex reasoning)
                      ↓
EXECUTION PHASE →  Sonnet (faster, cheaper)
```

### Recommended Model Selection

| Task | Model | Reason |
|------|-------|--------|
| Orchestrator decisions | Sonnet | Good judgment, fast |
| Search iterations | Haiku | 10x cheaper, sufficient for queries |
| Reflection/synthesis | Sonnet | Needs reasoning |
| Final answer | Sonnet/Opus | Quality matters |
| Code generation | Opus | Highest capability |

---

## 6. Context Management

### Auto-Compaction (Claude Code)

```bash
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50  # Compact at 50% capacity
```

**How it works:**
- Recent messages: full detail
- Older messages: summarized
- Key facts/entities: preserved

### Conversation History Limits

Most agents limit conversation history to last N messages:
- Claude Code: configurable
- Our implementation: last 5 messages
- **Gap**: Should be dynamic based on relevance

---

## 7. Dead-End Tracking (Critical Missing Feature)

### The Problem
Without tracking failed paths, agents:
- Repeat the same searches
- Go in circles
- Waste tokens and time

### Solution

```typescript
interface ReflectionOutput {
  keyFindings: string;
  hypothesesStrengthened: string[];
  hypothesesWeakened: string[];
  deadEnds: string[];              // Paths that led nowhere
  queriesNotToRepeat: string[];    // Exact queries to avoid
}
```

### Manus AI Pattern
- Track every failed approach
- Build "negative knowledge" base
- Use for future query planning

---

## 8. Stopping Conditions

### Multi-Signal Stopping (Best Practice)

```typescript
stopWhen: [
  stepCountIs(MAX_STEPS),           // Hard limit
  budgetExceeded(MAX_COST),         // Cost ceiling
  confidenceReached(0.9),           // Semantic completion
  noNewInformation(3),              // Diminishing returns
  userAbort(),                      // Manual interrupt
]
```

### Hook-Based Stop Prevention (Claude Code)

```json
{
  "hooks": {
    "Stop": [{
      "type": "prompt",
      "prompt": "Check if objectives met. Return 'block' to continue."
    }]
  }
}
```

---

## 9. Research Brief Structure

### Enhanced Brief Schema

```typescript
interface ResearchBrief {
  objective: string;
  stoppingConditions: string;
  successCriteria: string;

  // Enhanced fields:
  knownConstraints: string[];    // What we already know won't work
  prioritySignals: string[];     // What to look for first
  antiPatterns: string[];        // What to avoid
  previousAttempts?: Episode[];  // Context from prior research
}
```

---

## 10. Key Gaps in Our Current Implementation

| Feature | Current State | Target State |
|---------|---------------|--------------|
| Memory | Findings only | Episodes (queries + findings + dead-ends) |
| Context | Last 5 messages | Auto-compaction with summarization |
| Checkpoints | None | Rollback to previous states |
| Subagents | None | Isolated context per specialist |
| Model selection | Single model | Hybrid (cheap for search, smart for synthesis) |
| Dead-end tracking | None | Track and avoid failed paths |
| Query deduplication | None | Don't repeat failed queries |
| Cost ceiling | None | `--max-budget-usd` equivalent |

---

## Implementation Priority

### High Priority (Do First)

1. **Store full episodes** - queries + findings + dead-ends
2. **Add cost ceiling** - production safety
3. **Track dead-ends** - prevent circular searches

### Medium Priority

4. **Auto-compact brain** - handle long sessions
5. **Use Haiku for search** - 10x cost reduction
6. **Add checkpointing** - enable rollback

### Lower Priority

7. **Subagent architecture** - context isolation
8. **Hook-based stop prevention** - smarter termination
9. **Dynamic conversation history** - relevance-based

---

## Sources

- [Claude Code SDK Documentation](https://code.claude.com/docs)
- [Vercel AI SDK 6 Blog](https://vercel.com/blog/ai-sdk-6)
- Manus AI Architecture (from training data, May 2025)
- Tavily Integration Patterns (from codebase analysis)
- [Anthropic: Building Effective Agents](https://anthropic.com/research/building-effective-agents)
