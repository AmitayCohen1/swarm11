import { NextRequest, NextResponse } from 'next/server';

// Stripe payments disabled for POC
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Payments are disabled. Sign up to get free credits!' },
    { status: 503 }
  );
}
