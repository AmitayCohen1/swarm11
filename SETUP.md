# Quick Setup Guide

## Required Environment Variables

Before running the app, you need to set up these environment variables in `.env.local`:

### 1. Clerk Authentication (Required to run dev server)

Go to [clerk.com](https://clerk.com):
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 2. Neon Database (Required to run dev server)

Go to [neon.tech](https://neon.tech):
```bash
DATABASE_URL=postgresql://...
```

After setting this, run:
```bash
npm run db:push
```

### 3. Anthropic API (Required for research agent)

Go to [console.anthropic.com](https://console.anthropic.com):
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Exa AI Search (Required for web search)

Go to [exa.ai](https://exa.ai):
```bash
EXA_API_KEY=...
```

### 5. Stripe (Optional - for credit purchases)

Go to [stripe.com](https://stripe.com):
```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Minimal Setup to Start Development

To just run the dev server and see the UI, you need:
1. Clerk keys (authentication)
2. Neon database URL (run `npm run db:push` after)

To actually run research:
3. Anthropic API key
4. Exa AI key

Stripe is optional for now (credit purchases won't work without it, but users will have 100 free credits).

## Start Development

```bash
npm run dev
```

Visit `http://localhost:3000` - you should now see the research platform instead of the Next.js template!
