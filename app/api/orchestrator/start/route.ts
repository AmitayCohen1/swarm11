import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orchestratorSessions, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createOrchestratorAgent, createInitialState } from '@/lib/agents/orchestrator-agent';
import { hasEnoughCredits, deductCredits, getOrCreateUser } from '@/lib/credits';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get request body
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // 3. Get or create user
    const user = await getOrCreateUser(clerkUserId, null);
    const userId = user.id;

    // 4. Check credits (estimate: 200 credits for initial processing)
    const estimatedCost = 200;
    const hasCredits = await hasEnoughCredits(userId, estimatedCost);
    if (!hasCredits) {
      return NextResponse.json(
        { error: 'Insufficient credits', requiredCredits: estimatedCost },
        { status: 402 }
      );
    }

    // 5. Create orchestrator session
    const [session] = await db
      .insert(orchestratorSessions)
      .values({
        userId: userId,
        status: 'active',
        creditsUsed: 0,
        conversationHistory: [],
      })
      .returning();

    // 6. Create orchestrator agent and process first message
    const orchestrator = createOrchestratorAgent();
    const initialState = createInitialState();

    const result = await orchestrator.process(message, initialState);

    // 7. Update session with result
    const [updatedSession] = await db
      .update(orchestratorSessions)
      .set({
        conversationHistory: result.state.conversationHistory,
        currentDocument: result.state.currentDocument,
        lastResearchResult: result.state.lastResearchResult as any,
        creditsUsed: result.creditsUsed,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorSessions.id, session.id))
      .returning();

    // 8. Deduct credits
    await deductCredits(userId, result.creditsUsed);

    // 9. Get updated user credits
    const [updatedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    return NextResponse.json({
      sessionId: updatedSession.id,
      action: result.action,
      message: result.message,
      researchResult: result.researchResult,
      creditsUsed: result.creditsUsed,
      userCredits: updatedUser.credits,
      status: updatedSession.status,
    });
  } catch (error) {
    console.error('Error starting orchestrator session:', error);
    console.error('Stack:', (error as Error).stack);
    return NextResponse.json(
      { error: 'Internal server error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
