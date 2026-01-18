# Swarm10

An autonomous research agent platform that uses Claude Sonnet 4.5 with tool calling to conduct strategic research with tangible results. The agent autonomously searches the web, synthesizes findings, and delivers actionable intelligence.

## Features

- **Orchestrator Agent**: Intelligent agent that decides when to ask clarifying questions, respond directly, or launch research
- **Autonomous Research**: Multi-step research execution using ToolLoopAgent with adaptive strategy
- **Smart Decision Making**: Routes between chat responses, clarification questions, and research based on message context
- **Tavily Integration**: AI-powered web search with quality sources and citations
- **Knowledge Vault**: Real-time accumulated research findings with timestamps
- **Clean Chat UX**: Minimal timeline showing research process inline with user-centric results. No more bulky boxes or redundant icons.
- **Credit System**: Pay-per-use model with Stripe integration (currently disabled for POC - free to use)

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Authentication**: Clerk
- **Database**: Neon PostgreSQL + Drizzle ORM
- **AI**: Anthropic Claude Sonnet 4.5 with tool calling
- **Research**: Tavily AI (web search with AI-generated answers)
- **Payments**: Stripe (currently disabled for POC)

## Setup Instructions

### 1. Clone and Install

```bash
cd swarm11
npm install
```

### 2. Set Up Clerk Authentication

1. Go to [clerk.com](https://clerk.com) and create a new application
2. Copy your publishable and secret keys
3. Add to `.env.local`:
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 3. Set Up Neon Database

1. Go to [neon.tech](https://neon.tech) and create a new project
2. Copy your connection string
3. Add to `.env.local`:
```bash
DATABASE_URL=postgresql://...
```

4. Generate and push database schema:
```bash
npm run db:generate
npm run db:push
```

### 4. Set Up Anthropic API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add to `.env.local`:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### 5. Set Up Tavily AI

1. Go to [tavily.com](https://tavily.com) and create an account
2. Navigate to API settings and create an API key
3. Add to `.env.local`:
```bash
TAVILY_API_KEY=tvly-...
```

### 6. Set Up Stripe

1. Go to [stripe.com](https://stripe.com) and create an account
2. Copy your publishable and secret keys from the dashboard
3. Add to `.env.local`:
```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

4. **Create Products and Prices** in Stripe Dashboard:
   - Go to Products → Create product
   - Create three products:
     - **Starter**: $10 for 1000 credits
     - **Pro**: $45 for 5000 credits
     - **Enterprise**: $160 for 20000 credits
   - Copy each price ID and add to `.env.local`:
```bash
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

5. **Set Up Webhook**:
   - For local testing, install Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   - Copy the webhook signing secret and add to `.env.local`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```
   - For production, add webhook endpoint in Stripe Dashboard pointing to: `https://yourdomain.com/api/webhooks/stripe`
   - Listen for event: `checkout.session.completed`

### 7. Run the App

```bash
npm run dev
```

Visit `http://localhost:3000`

## How It Works

### Chat Orchestrator Flow

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

### Orchestrator Decision Types

1. **`chat_response`**: Greetings only ("hi", "hello")
2. **`ask_clarification`**: Ask ONE specific question when request is too vague
   - Example: "I need customers" → "What product or service are you selling?"
3. **`start_research`**: Launch autonomous research with clear objective
   - Example: "Find DevRel candidates with 5+ years experience" → Immediate research

### Research Executor

- **Autonomous Loop**: Unlimited depth research (up to 500 steps) using ToolLoopAgent - keeps going until truly exhaustive
- **Tools Available**:
  - `search(query)`: Natural language web search via Tavily
  - `reflect(keyFindings, evaluation, nextMove, reasoning)`: Required after every search - captures findings and decides next move
  - `complete(...)`: Deliver final structured results
- **Action-Oriented**: Focuses on what user can DO (not just information)
- **Knowledge Vault**: Accumulates findings with timestamps in real-time

### Architecture

- **Chat Interface** (`/chat`): Clean UI showing only user messages and final answers
- **Details Panel**: Side panel with Activity (queries/results) and Knowledge Vault tabs
- **Orchestrator Agent**: Analyzes messages and routes to appropriate handler
- **Research Executor**: Autonomous ToolLoopAgent that adapts strategy during research
- **SSE Streaming**: Real-time updates for research progress (activity events)
- **Tavily Search**: AI-powered web search with quality sources and citations

### Credit System (Currently Disabled for POC)

**All functionality is free during POC phase.** Credits are tracked but NOT deducted.

**Planned costs:**
- Orchestrator decision: ~20 credits (~1000 tokens)
- Research per step: ~50-100 credits (varies by response length)
- Tavily search: ~10 credits per search
- Total per research: ~200-500 credits depending on complexity

**Re-enable for production:**
1. Uncomment `deductCredits()` in research-executor-agent.ts
2. Add preflight credit check in message route
3. Re-enable credit error handling

Users get 5000 free credits on signup. Can purchase more via Stripe Checkout (when enabled).

## Database Schema

### users
```typescript
{
  id: uuid
  clerkId: text
  email: text
  credits: integer
  lifetimeCreditsUsed: integer
  createdAt: timestamp
  updatedAt: timestamp
}
```

### chat_sessions
```typescript
{
  id: uuid
  userId: uuid (FK)
  messages: jsonb (conversation history)
  brain: text (accumulated research knowledge)
  status: "active" | "researching" | "completed"
  creditsUsed: integer
  currentResearch: jsonb (active research state)
  createdAt: timestamp
  updatedAt: timestamp
}
```

## API Routes

### Chat

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

### Credits & Billing
- `GET /api/credits` - Get user credit balance
- `POST /api/credits/purchase` - Create Stripe Checkout session
- `POST /api/webhooks/stripe` - Handle Stripe webhooks

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
    Step 2: reflect(evaluation, nextMove: narrow, reasoning)
    Step 3: search("DevRel candidates available for hire 2026")
    ...
    Step N: complete(findings, actions, sources)
```

### Example 3: Greeting → Chat Response
```
User: "hi"
    ↓
Orchestrator: chat_response
    "Hello! What would you like me to research?"
```

## Development

### Database Commands

```bash
npm run db:generate  # Generate migrations from schema
npm run db:push      # Push schema to database
npm run db:studio    # Open Drizzle Studio
```

### Environment Variables

All required variables are in `.env.local`:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Neon
DATABASE_URL=

# Anthropic
ANTHROPIC_API_KEY=

# Tavily AI
TAVILY_API_KEY=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_ENTERPRISE=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Key Design Decisions

1. **Separation of Concerns**: Orchestrator = decision maker (WHAT to do), Research Executor = execution engine (HOW to do it)
2. **ToolLoopAgent**: Uses AI SDK's ToolLoopAgent for autonomous multi-step research
3. **Action-Oriented Research**: Focuses on what user can DO, not just impressive-sounding info
4. **Natural Language Queries**: Searches use full questions, not keywords
5. **Clean Chat UX**: Only shows user messages and final answers; detailed activity in side panel
6. **Knowledge Vault**: Accumulates findings with timestamps; supports multiple research sessions per chat
7. **SSE Streaming**: Real-time progress updates without WebSocket complexity

## Design Principles

1. **User-Centric**: Ask clarifying questions when truly needed, focus on actionable results
2. **Action-Oriented Research**: Research must lead to concrete next steps
3. **Natural Interaction**: Use natural language queries, show reasoning and reflections
4. **Transparency**: Make research process visible in Details panel, keep chat clean

## License

MIT
# swarm11
