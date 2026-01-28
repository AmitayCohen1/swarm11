# Research System Refactor - DONE

## The New Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       CORTEX                            │
│                                                         │
│   • start(objective) → initial nodes                    │
│   • processResult(node) → findings, followups, done?    │
│   • finish(state) → final answer                        │
│                                                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ spawns
                 ↓
┌─────────────────────────────────────────────────────────┐
│                   NODE (research question)              │
│                                                         │
│   Loop:                                                 │
│     1. Search                                           │
│     2. Got enough? → if no, search again                │
│   Done:                                                 │
│     3. Write answer + suggest followups                 │
│     4. Send back to Cortex                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## What Changed

### cortex.ts
- **Before**: `evaluate()` did everything (spawn decisions + finding updates mixed)
- **After**: Clean API:
  - `start(objective)` → initial nodes
  - `processResult(node)` → { findingUpdates, approvedFollowups, newNodes, done }
  - `finish(state)` → final answer

### runner.ts
- **Before**: Complex loop with `evaluate()` called for initial AND completions
- **After**: Simple loop:
  1. `cortex.start()` → spawn initial nodes
  2. Run nodes in parallel
  3. On completion → `cortex.processResult()` → handle decision
  4. On done → `cortex.finish()` → write final answer

### Key Fixes
1. **Tree structure now works**: Approved followups get `parentId` set to the completed node
2. **Decision events emitted**: `brain_decision` SSE events now sent via `onDecision` callback
3. **Clear separation**: Cortex decides, Nodes work, Runner orchestrates
4. **Final synthesis**: `cortex.finish()` actually gets called now

## Files Changed
- `lib/research/cortex.ts` - Rewritten with clean API
- `lib/research/runner.ts` - Simplified loop
- `lib/research/researcher.ts` - Minor: `onProgress` → `onSearch`
- `lib/research/run.ts` - Added `onDecision` callback
- `app/api/tree-research/route.ts` - Updated to new API
- `hooks/useSession.ts` - Added `decisionsChanged` check (earlier fix)
