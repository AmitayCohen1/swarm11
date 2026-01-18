# Research Orchestration Platform

An autonomous research agent platform that uses Claude Sonnet 4.5 with tool calling to conduct comprehensive online research. The agent autonomously searches the web, synthesizes findings, and self-reviews its work.

## Features

- **Orchestrator Agent**: Intelligent agent that decides when to use research vs direct response
- **Autonomous Research**: Multi-step research execution with adaptive strategy
- **Smart Decision Making**: Automatically starts research for any information request
- **Perplexity Integration**: Deep research with AI-powered search and citations
- **Structured Brain**: Organized knowledge base with resources, insights, and findings
- **Credit-Based System**: Pay-per-use model with Stripe integration
- **Modern Chat UI**: Beautiful, responsive interface with dark mode and real-time updates

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Authentication**: Clerk
- **Database**: Neon PostgreSQL + Drizzle ORM
- **AI**: Anthropic Claude Sonnet 4.5 with tool calling
- **Research**: Perplexity AI (sonar-pro)
- **Payments**: Stripe

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

### 5. Set Up Perplexity AI

1. Go to [perplexity.ai](https://www.perplexity.ai) and sign in
2. Navigate to API settings and create an API key
3. Add to `.env.local`:
```bash
PERPLEXITY_API_KEY=pplx-...
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

1. **User sends message**: Any question or request
2. **Orchestrator analyzes** the message and decides:
   - `chat_response`: Answer directly (casual conversation, simple questions, clarifications)
   - `start_research`: Launch autonomous research (complex questions requiring web research)
3. **If research needed**:
   - Research executor agent runs autonomously for up to 30 steps
   - Searches web using Perplexity AI
   - Accumulates findings in a shared "brain"
   - Updates chat in real-time with progress
4. **Present results**: Comprehensive research with sources streamed to chat

### Architecture

- **Chat Interface** (`/chat`): Conversational UI with message history and brain panel
- **Orchestrator Agent**: Analyzes messages and routes to appropriate handler
- **Adaptive Research Executor**: Autonomous agent that learns and pivots during research
  - Evaluates results after each search
  - Pivots strategy based on findings
  - Progressively narrows from 100 → 10 → 3 → 1
  - Cross-references across multiple sources
- **Shared Brain**: Structured knowledge base with resources, insights, and reflections
- **SSE Streaming**: Real-time updates for research progress
- **Perplexity Search**: AI-powered web search with citations and comprehensive answers

### Credit System

- 1 credit = $0.01 USD
- Orchestrator decision: ~20 credits per message
- Research execution: Varies by complexity (~50-500 credits)
  - Each Perplexity search: ~10-20 credits
  - Claude reasoning: ~50-100 credits per step
- Users get 5000 free credits on signup
- Can purchase more via Stripe Checkout

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
- `POST /api/chat/start` - Start new chat session
- `POST /api/chat/[id]/message` - Send message (SSE stream)
- `POST /api/chat/[id]/stop` - Stop research in progress

### Credits & Billing
- `GET /api/credits` - Get user credit balance
- `POST /api/credits/purchase` - Create Stripe Checkout session
- `POST /api/webhooks/stripe` - Handle Stripe webhooks

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

# Perplexity AI
PERPLEXITY_API_KEY=

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

1. **Single Agent vs Multi-Agent**: Chose single agent with self-review to simplify architecture
2. **Tool Calling Pattern**: Uses native Anthropic tool calling API for autonomy
3. **Polling vs WebSockets**: Chose polling for simplicity (every 2 seconds)
4. **Conversation History in JSONB**: Stored as JSONB for flexibility
5. **Client-Driven Execution**: User controls when to continue iterations
6. **Explicit Planning**: Agent uses `<thinking>` blocks before acting (Anthropic best practice)

## Based on Research

This implementation follows Anthropic's guidance:
- "Agents are just workflows with feedback loops"
- "Planning steps are crucial before action"
- "Single model does most of the heavy lifting"
- "Simplicity over complex orchestration"

## License

MIT
# swarm11
