# Chat Orchestrator with Research Executor

## Overview

The Chat Orchestrator is an intelligent conversational agent that decides when to ask clarifying questions, respond directly, or launch autonomous research. This creates a clean separation of concerns:

- **Orchestrator Chat Agent**: Analyzes messages and makes routing decisions
- **Research Executor Agent**: Autonomous multi-step research using ToolLoopAgent
- **Knowledge Vault (Brain)**: Accumulated research knowledge visible in real-time

## Architecture

```
User Message
    ↓
Orchestrator Chat Agent (Decision Maker)
    ├─→ Chat Response (greetings only)
    ├─→ Ask Clarification (vague requests - "I need customers")
    └─→ Start Research (clear objective - "Find DevRel candidates")
            ↓
        Research Executor Agent (ToolLoopAgent)
            ├─ Tavily search (natural language queries)
            ├─ Reflect on results
            ├─ Save findings to Knowledge Vault
            └─ Loop up to 30 steps
            ↓
        Stream updates to chat (SSE)
```

## Key Components

### 1. Orchestrator Chat Agent (`lib/agents/orchestrator-chat-agent.ts`)

Main agent that analyzes each user message and decides:

**Decision Types:**
- `chat_response` - Greetings only ("hi", "hello")
- `ask_clarification` - Ask questions when request is too vague
- `start_research` - Launch autonomous research with clear objective

**How It Decides:**
- **Ask clarification** when missing critical info:
  - "I need customers" → what product?
  - "Find companies" → for what purpose?
  - "Research candidates" → for what role?

- **Start research** when there's enough context:
  - "Find DevRel candidates" ✓
  - "Research React state libraries" ✓
  - "Find media companies for audio fact-checking" ✓

**Features:**
- Uses Claude Sonnet 4.5 for decision making
- Forces tool usage (`toolChoice: 'required'`)
- Considers conversation history and accumulated brain
- Asks ONE specific clarifying question (not multiple)

### 2. Research Executor Agent (`lib/agents/research-executor-agent.ts`)

Autonomous research agent using AI SDK's ToolLoopAgent. Receives a clear `researchObjective` string from orchestrator and executes research.

**Tools Available:**

1. **`search(query)`** - Search the web using Tavily
   - Uses natural language questions, not keywords
   - Example: "What are the best DevRel candidates in 2026?" (not "devrel candidates 2026")
   - Returns answer + sources with {title, url}

2. **`reflect(keyFindings, evaluation, nextMove, reasoning)`** - Required after EVERY search
   - keyFindings: Concrete discoveries (names, companies, numbers, tools, resources)
   - evaluation: What was learned, what's useful, what's missing (1-2 sentences)
   - nextMove: continue, pivot, narrow, deep-dive, ask_user, complete
   - reasoning: What you found, what you want to search next, and why (1-2 sentences max)
   - Saves findings to Knowledge Vault with timestamp
   - Shows in chat: "[keyFindings]"

3. **`complete(reasoning, confidenceLevel, keyFindings, recommendedActions, sourcesUsed, finalAnswerMarkdown)`** - Deliver final results
   - Must include actionable next steps
   - Short, structured markdown
   - Only most relevant sources

**Research Philosophy:**

The agent is instructed to produce **action-oriented** research:

- **Before searching**: Decide what the user should be able to DO after reading the answer
- **After each search**: Ask "Can the user act on this?"
- **Prefer**: Specific people, companies, tools, resources the user can reach/use/contact
- **Avoid**: Big names or large numbers without clear action path

**Features:**
- Unlimited depth research (up to 500 steps) - keeps going until truly exhaustive
- Uses Tavily AI for web searches
- Accumulates findings in Knowledge Vault
- Streams real-time progress via SSE
- Credits disabled for POC (free to use)

### 3. Knowledge Vault (Brain)

Persistent markdown storage that accumulates research findings:

**Structure:**
```markdown
# [Research Objective]

---
**[14:23] RESEARCH UPDATE**

[Concrete discoveries: names, companies, numbers, tools, resources]

**Evaluation:** [What the search revealed, what's useful, what's missing - 1-2 sentences]

**Next Move:** continue

**Reasoning:** [What you found, what you want to search next, and why - 1-2 sentences]

---
```

**Features:**
- Appends new research (doesn't wipe previous)
- Shows in real-time during research
- Visible in sidebar panel
- Timestamped entries
- Supports multiple research sessions per chat

### 4. API Routes

#### Start New Chat Session
```
POST /api/chat/start
Response: {
  sessionId: string
  status: 'created'
  message: string
}
```

#### Send Message (SSE Stream)
```
POST /api/chat/[id]/message
Body: { message: string }
Response: Server-Sent Events stream with:
  - type: 'analyzing' - Orchestrator analyzing message
  - type: 'decision' - Decision made (chat_response/ask_clarification/start_research)
  - type: 'message' - Chat message or clarification question
  - type: 'research_started' - Research kicked off
  - type: 'research_query' - Search query being executed
  - type: 'search_result' - Results from Tavily with sources
  - type: 'agent_thinking' - Reflections, findings saved
  - type: 'brain_update' - Knowledge Vault updated
  - type: 'complete' - Stream finished
  - type: 'error' - Error occurred
```

#### Stop Research
```
POST /api/chat/[id]/stop
Response: {
  success: boolean
}
```

## Message Flow Examples

### Example 1: Vague Request → Clarification
```
User: "I need customers"
    ↓
Orchestrator: ask_clarification
    "I can help you find customers! What product or service are you selling?"
    ↓
User: "audio fact-checking platform"
    ↓
Orchestrator: start_research
    researchObjective: "Find customers for audio fact-checking platform"
    ↓
Research Executor: [autonomous search loop]
```

### Example 2: Clear Request → Immediate Research
```
User: "Find DevRel candidates with 5+ years experience"
    ↓
Orchestrator: start_research
    researchObjective: "Find Developer Relations candidates with 5+ years experience"
    ↓
Research Executor:
    Step 1: search("Who are the top DevRel professionals in 2026?")
    Step 2: reflect(keyFindings, evaluation, nextMove: narrow, reasoning)
    Step 3: search("DevRel candidates available for hire 2026")
    Step 4: reflect(keyFindings, evaluation, nextMove: deep-dive, reasoning)
    Step 5-10: search specific candidates, verify experience, find contact info
    Step 11-20: cross-reference skills, compare options, explore alternatives
    Step 21-30: verify through multiple sources, explore tangents, check social presence
    Step 31-40: deep dive into promising candidates, verify claims, find references
    Step 41+: explore edge cases, alternative sources, niche communities
    ...
    Step N (after exhaustive research - 20, 30, 50+ searches): complete(findings, actions, sources)
```

### Example 3: Greeting → Chat Response
```
User: "hi"
    ↓
Orchestrator: chat_response
    "Hello! What would you like me to research?"
```

## Usage Example

### Backend Integration

```typescript
import { analyzeUserMessage } from '@/lib/agents/orchestrator-chat-agent';
import { executeResearch } from '@/lib/agents/research-executor-agent';

// Analyze message
const decision = await analyzeUserMessage(
  userMessage,
  conversationHistory,
  currentBrain
);

// decision.type: 'chat_response' | 'ask_clarification' | 'start_research'
// decision.message: Response text (if chat_response or ask_clarification)
// decision.researchObjective: Research goal (if start_research)

// Handle decision
if (decision.type === 'start_research') {
  await executeResearch({
    chatSessionId,
    userId,
    researchObjective: decision.researchObjective,
    conversationHistory, // Last 5 messages for context
    onProgress: (update) => {
      // Stream updates to frontend
      if (update.type === 'brain_update') {
        // Send Knowledge Vault update
      }
      if (update.type === 'agent_thinking') {
        // Send thinking/reflection to chat
      }
      if (update.type === 'search_result') {
        // Send search results with sources
      }
    }
  });
}
```

## Environment Variables

Add to your `.env.local`:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
TAVILY_API_KEY=tvly-... # Get from https://tavily.com

# Optional - for credits/payments (currently disabled for POC)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
STRIPE_SECRET_KEY=...
```

## Database Schema

Uses the `chat_sessions` table:

```sql
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  messages JSONB DEFAULT '[]', -- Conversation history
  brain TEXT, -- Knowledge Vault (markdown)
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'researching' | 'completed'
  credits_used INTEGER NOT NULL DEFAULT 0,
  current_research JSONB, -- Active research state
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

## Orchestrator Decision Schema

```typescript
interface OrchestratorDecision {
  type: 'chat_response' | 'ask_clarification' | 'start_research';
  message?: string; // For chat_response or ask_clarification
  researchObjective?: string; // For start_research
  confirmationMessage?: string; // Optional confirmation before research
  reasoning: string;
}
```

## Credits (Currently Disabled for POC)

Credits are tracked but NOT deducted. All functionality is free during POC phase.

**Planned costs:**
- Orchestrator decision: ~20 credits (~1000 tokens)
- Research per step: ~50-100 credits (varies by response length)
- Tavily search: ~10 credits per search
- Total per research: ~200-500 credits depending on complexity

**Re-enable for production:**
1. Uncomment `deductCredits()` in research-executor-agent.ts:203
2. Add preflight credit check in message route
3. Re-enable credit error handling

## Key Features

| Feature | Description |
|---------|-------------|
| **Smart Routing** | Automatically decides between chat, clarification, and research |
| **Clarifying Questions** | Asks ONE specific question when request is vague |
| **Action-Oriented** | Research focuses on what user can DO (not just info) |
| **Natural Language** | Searches use full questions, not keywords |
| **Autonomous Research** | ToolLoopAgent runs multi-step research automatically |
| **Real-time Updates** | SSE streaming shows progress as it happens |
| **Knowledge Vault** | Accumulated findings with timestamps |
| **Tavily Integration** | AI-powered web search with quality sources |
| **Free POC** | All research free during proof-of-concept phase |

## Troubleshooting

### Orchestrator not asking questions
- Check `toolChoice: 'required'` is set in orchestrator-chat-agent.ts:121
- Verify decision tool includes all 3 options
- Test with obviously vague message: "I need customers"

### Tavily API Errors
- Check API key is valid: https://tavily.com
- Verify rate limits haven't been exceeded
- Ensure TAVILY_API_KEY in .env.local

### Research not stopping
- Check MAX_STEPS (currently 30) in research-executor-agent.ts:34
- Research can be stopped via POST /api/chat/[id]/stop
- Sets status to non-'researching' to break loop

### Knowledge Vault not updating
- Verify brain updates emit onProgress({ type: 'brain_update', brain })
- Check frontend listens for brain_update events
- Brain should append, not replace

### Sources not showing
- Tavily returns `results` array with {title, url, content, score}
- Map to sources: `results.map(r => ({ title: r.title, url: r.url }))`
- Fixed in research-executor-agent.ts:238-241

## Design Principles

1. **Separation of Concerns**
   - Orchestrator = decision maker (WHAT to do)
   - Research Executor = execution engine (HOW to do it)

2. **User-Centric**
   - Ask clarifying questions when truly needed
   - Focus on actionable results
   - Show progress transparently

3. **Action-Oriented Research**
   - Research must lead to concrete next steps
   - Prefer specific, reachable resources
   - Avoid impressive-sounding but unusable info

4. **Natural Interaction**
   - Use natural language queries
   - Show reasoning and reflections
   - Make research process visible

## Future Enhancements

1. **Multi-Source Research**: Combine Tavily with other search APIs
2. **Caching**: Cache common research queries
3. **Research Templates**: Pre-defined strategies for common use cases
4. **Feedback Loop**: Let users rate research quality
5. **Tool Chaining**: Allow research to call specialized tools (scraping, data analysis)
6. **Cost Optimization**: Batch queries, smarter stopping criteria
