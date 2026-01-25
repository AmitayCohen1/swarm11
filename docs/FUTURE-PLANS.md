# Future Plans

## Tree-Based Research Architecture

Currently: flat list of research questions (depth=1)

Future: tree structure where questions can spawn sub-questions

```
                    Brain (cortex)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
         Q1 (doc)    Q2 (doc)    Q3 (doc)
            │           │
        ┌───┴───┐       ▼
        ▼       ▼    Q2.1 (doc)
     Q1.1     Q1.2
```

### Context Scoping

Each node only sees **its parent chain** up to cortex, not siblings or cousins.

Example - Q1.2's context:
- Cortex objective/criteria
- Q1's doc (parent)
- Its own question memory

NOT: Q2, Q3, Q1.1, Q2.1, etc.

### Benefits

1. **Focused context** - each question only sees relevant parent findings
2. **No context explosion** - don't load entire tree into every prompt
3. **Deep research** - can drill down into specific areas
4. **Parallel branches** - siblings don't pollute each other

### Why Modular Memory Helps

With separate storage (central memory + question memories):
- Easy to traverse parent chain and load just those docs
- Each question memory stays isolated
- Brain can decide to spawn sub-questions within any node
- Clean boundaries make tree operations simple

### Implementation Notes

- Add `parentId` to question structure (null = top-level)
- Question context = walk up parentId chain, collect docs
- Brain can spawn at any level, not just top
- Consider max depth limit to prevent infinite drilling
