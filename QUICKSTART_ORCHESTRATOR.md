# Quick Start: Orchestrator Agent

## What is the Orchestrator Agent?

The Orchestrator Agent is an intelligent decision-making agent that:
- **Decides when to research** vs respond directly
- **Uses Perplexity AI** for deep research when needed
- **Generates research questions** automatically
- **Returns structured results** with citations

## 5-Minute Setup

### 1. Add Perplexity API Key

Get your API key from [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)

```bash
# Add to .env.local
PERPLEXITY_API_KEY=pplx-...
```

### 2. Run Database Migration

```bash
# Option 1: Use Drizzle
npx drizzle-kit push

# Option 2: Run SQL directly
psql $DATABASE_URL < migrations/add_orchestrator_sessions.sql
```

### 3. Test the API

```bash
curl -X POST http://localhost:3000/api/orchestrator/start \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the latest AI breakthroughs?"}'
```

## Usage Examples

### Frontend Integration

```typescript
import { useOrchestrator } from '@/hooks/useOrchestrator';

function MyComponent() {
  const { startSession, sendMessage, messages, isLoading } = useOrchestrator();

  return (
    <div>
      <button onClick={() => startSession('Hello!')}>
        Start
      </button>

      {messages.map((msg, i) => (
        <div key={i}>
          <strong>{msg.role}:</strong> {msg.content}
          {msg.researchResult && (
            <div>
              <h4>Research Results:</h4>
              <p>{msg.researchResult.structuredResult.summary}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Using the Pre-built Component

```typescript
import OrchestratorChat from '@/components/orchestrator/OrchestratorChat';

export default function Page() {
  return <OrchestratorChat />;
}
```

### Direct API Calls

```typescript
// Start conversation
const response = await fetch('/api/orchestrator/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What are quantum computers good for?'
  })
});

const data = await response.json();
// data.action: 'respond' | 'research' | 'clarify'
// data.message: Response to show user
// data.researchResult: (if action === 'research')

// Continue conversation
await fetch(`/api/orchestrator/${data.sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Tell me more about quantum error correction'
  })
});
```

## How It Works

```
User: "What are the latest AI breakthroughs?"
  ↓
Orchestrator: Decides this needs research
  ↓
Research Tool:
  1. Generates questions:
     - What are recent AI model advances?
     - What are new AI applications?
     - What are AI research trends?
  2. Executes via Perplexity
  3. Synthesizes results
  ↓
User receives: Comprehensive answer with citations
```

## Action Types

### `respond` - Direct Response
- Simple questions
- Casual conversation
- Follow-ups

Example:
```
User: "What is machine learning?"
→ Direct response without research
```

### `research` - Deep Research
- Complex topics
- Need current information
- Require citations

Example:
```
User: "Latest quantum computing breakthroughs?"
→ Research tool activated
→ Returns structured results with sources
```

### `clarify` - Need More Info
- Ambiguous requests
- Multiple interpretations

Example:
```
User: "Tell me about AI"
→ Asks: "What aspect of AI interests you?"
```

## Response Structure

When action is `research`, you get:

```typescript
{
  questions: [
    {
      question: "What are recent advances?",
      reasoning: "To understand current state",
      priority: "high"
    }
  ],
  results: [
    {
      question: "...",
      answer: "...",
      sources: [...]
    }
  ],
  structuredResult: {
    summary: "# Comprehensive Summary\n\n...",
    keyFindings: [
      "Finding 1",
      "Finding 2"
    ],
    sources: [
      {
        title: "Source 1",
        url: "https://...",
        relevance: "..."
      }
    ],
    confidenceLevel: "high",
    suggestedFollowUps: ["Question 1", "Question 2"]
  }
}
```

## Credit Costs

| Operation | Credits |
|-----------|---------|
| Decision making | ~20 |
| Research execution | ~160 |
| **Total per research** | ~200 |

Compare to legacy agent: ~200 per iteration

## vs Legacy Research Agent

| Feature | Legacy | Orchestrator |
|---------|--------|--------------|
| Casual chat | Over-engineered | Direct response |
| Complex research | Exa search | Perplexity AI |
| Structured output | Basic | Rich with confidence |
| Clarification | Limited | Built-in |
| Modularity | Monolithic | Separated tools |

## Troubleshooting

### "Missing PERPLEXITY_API_KEY"
Add to `.env.local`:
```bash
PERPLEXITY_API_KEY=pplx-...
```

### "Table orchestrator_sessions does not exist"
Run migration:
```bash
npx drizzle-kit push
# or
psql $DATABASE_URL < migrations/add_orchestrator_sessions.sql
```

### High credit usage
- Research uses ~200 credits per query
- Use legacy agent for simple searches
- Implement caching for common questions

## Advanced Usage

### Custom Research Depth

```typescript
import { createResearchTool } from '@/lib/tools/research-tool';

const tool = createResearchTool();
const result = await tool.execute({
  objective: 'Deep dive into quantum computing',
  maxQuestions: 7  // Default is 5
});
```

### Direct Tool Usage

```typescript
import { createResearchTool } from '@/lib/tools/research-tool';

const tool = createResearchTool();
const result = await tool.execute({
  objective: 'What is happening in quantum computing?',
  context: 'User is a physicist interested in qubits'
});

console.log(result.structuredResult.summary);
console.log(result.structuredResult.keyFindings);
```

## Next Steps

- Read [ORCHESTRATOR.md](./ORCHESTRATOR.md) for full documentation
- Check out the example component: `components/orchestrator/OrchestratorChat.tsx`
- Use the hook: `hooks/useOrchestrator.ts`
- Explore API routes: `app/api/orchestrator/`

## Support

Questions? Check:
1. [ORCHESTRATOR.md](./ORCHESTRATOR.md) - Full documentation
2. [README.md](./README.md) - General setup
3. API route examples in `app/api/orchestrator/`
