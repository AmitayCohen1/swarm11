import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { getOrCreateUser, hasEnoughCredits } from '@/lib/credits';

export async function POST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { objective, maxQueries = 20 } = await req.json();

    if (!objective?.trim()) {
      return NextResponse.json({ error: 'Objective required' }, { status: 400 });
    }

    // Validate maxQueries range
    if (maxQueries < 5 || maxQueries > 30) {
      return NextResponse.json({
        error: 'maxQueries must be between 5 and 30'
      }, { status: 400 });
    }

    // Get user and check credits
    const user = await getOrCreateUser(clerkUserId, null);
    const estimatedCost = maxQueries * 100; // ~100 credits per iteration

    if (!(await hasEnoughCredits(user.id, estimatedCost))) {
      return NextResponse.json({
        error: 'Insufficient credits',
        required: estimatedCost,
        available: user.credits
      }, { status: 402 });
    }

    // Create session
    const [session] = await db
      .insert(autonomousSessions)
      .values({
        userId: user.id,
        objective,
        maxQueries,
        status: 'active',
        brain: '',
        queriesExecuted: 0,
        creditsUsed: 0,
        iterationCount: 0
      })
      .returning();

    return NextResponse.json({
      sessionId: session.id,
      status: 'started',
      objective,
      maxQueries,
      estimatedCost
    });
  } catch (error: any) {
    console.error('Error starting autonomous session:', error);
    return NextResponse.json({
      error: 'Failed to start session',
      details: error.message
    }, { status: 500 });
  }
}
