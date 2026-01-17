# Research Orchestration Platform

An autonomous research agent platform that uses Claude Sonnet 4.5 with tool calling to conduct comprehensive online research. The agent autonomously searches the web, synthesizes findings, and self-reviews its work.

## Features

- **Orchestrator Agent**: Intelligent agent that decides when to use research vs direct response
- **Research Tool**: Dedicated tool that generates questions and executes them via Perplexity AI
- **Smart Decision Making**: Automatically chooses between direct response, research, or clarification
- **Perplexity Integration**: Deep research with AI-powered search and citations
- **Structured Output**: Rich results with key findings, sources, and confidence levels
- **Credit-Based System**: Pay-per-use model with Stripe integration
- **Modern Chat UI**: Clean, responsive interface with research result expansion

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

1. Go to [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)
2. Create an API key
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

### Orchestrator Agent Flow

1. **User sends message**: Any question or request
2. **Orchestrator decides**:
   - `respond`: Answer directly (casual conversation, simple questions)
   - `research`: Use research tool (complex questions, need citations)
   - `clarify`: Ask for more information (ambiguous requests)
3. **If research needed**:
   - Research tool generates 3-5 focused questions
   - Executes them in parallel via Perplexity AI
   - Synthesizes comprehensive findings with citations
4. **Present results**: Structured output with key findings, sources, confidence level

See [ORCHESTRATOR.md](./ORCHESTRATOR.md) for detailed documentation.

### Architecture

- **Orchestrator Agent**: Decision-making agent that routes requests
- **Research Tool**: Specialized tool for deep research with Perplexity
- **Modular Design**: Clean separation between orchestration and research
- **Conversation history**: Maintains full context across messages
- **Real-time updates**: Modern chat interface with immediate feedback

### Credit System

- 1 credit = $0.01 USD
- Decision making: ~20 credits
- Research execution: ~160 credits (question generation + Perplexity searches + synthesis)
- Total per research message: ~200 credits
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

### research_sessions
```typescript
{
  id: uuid
  userId: uuid (FK)
  objective: text
  document: text
  status: "active" | "completed" | "stopped" | "insufficient_credits"
  creditsUsed: integer
  conversationHistory: jsonb
  createdAt: timestamp
  updatedAt: timestamp
}
```

### tool_calls
```typescript
{
  id: uuid
  sessionId: uuid (FK)
  toolName: "web_search"
  input: jsonb
  output: jsonb
  creditsUsed: integer
  timestamp: timestamp
}
```

## API Routes

### Orchestrator
- `POST /api/orchestrator/start` - Start conversation with orchestrator
- `POST /api/orchestrator/[id]/message` - Send message to orchestrator
- `GET /api/orchestrator/[id]` - Get session state
- `POST /api/orchestrator/[id]/stop` - Stop orchestrator session

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

# Perplexity
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
