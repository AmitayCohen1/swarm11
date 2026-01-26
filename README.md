# Swarm11

Swarm11 is a **research chat app**: you send a message, it clarifies intent, then runs a bounded research loop and streams progress to the UI.

## Architecture

The single source of truth is:

- `docs/ARCHITECTURE.md`

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

```bash
# .env.local

# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Database
DATABASE_URL=postgresql://...

# AI + Search
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PERPLEXITY_API_KEY=pplx-...
```

### 3. Database

```bash
npm run db:generate
npm run db:push
```

### 4. Run

```bash
npm run dev
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js (App Router) |
| AI | AI SDK (OpenAI + Anthropic) |
| Search | Perplexity (Sonar) |
| Database | Neon PostgreSQL + Drizzle |
| Auth | Clerk |
| Styling | Tailwind CSS |

## License

MIT
