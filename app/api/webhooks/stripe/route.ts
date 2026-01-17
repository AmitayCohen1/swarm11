import { NextRequest, NextResponse } from 'next/server';

// Stripe webhooks disabled for POC
export async function POST(request: NextRequest) {
  return NextResponse.json({ received: true });
}
