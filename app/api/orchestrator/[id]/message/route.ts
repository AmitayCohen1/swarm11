import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orchestratorSessions, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createOrchestratorAgent, OrchestratorState } from '@/lib/agents/orchestrator-agent';
import { hasEnoughCredits, deductCredits, getOrCreateUser } from '@/lib/credits';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authenticate user
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: sessionId } = await params;

    // 2. Get request body
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // 3. Get user
    const user = await getOrCreateUser(clerkUserId, null);
    const userId = user.id;

    // 4. Get session
    const [session] = await db
      .select()
      .from(orchestratorSessions)
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.userId, userId)
        )
      );

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // 5. Check if session is active
    if (session.status !== 'active') {
      return NextResponse.json(
        { error: 'Session is not active', status: session.status },
        { status: 400 }
      );
    }

    // 6. Check credits (estimate: 200 credits per message)
    const estimatedCost = 200;
    const hasCredits = await hasEnoughCredits(userId, estimatedCost);
    if (!hasCredits) {
      // Mark session as insufficient credits
      await db
        .update(orchestratorSessions)
        .set({ status: 'insufficient_credits' })
        .where(eq(orchestratorSessions.id, sessionId));

      return NextResponse.json(
        { error: 'Insufficient credits', requiredCredits: estimatedCost },
        { status: 402 }
      );
    }

    // 7. Reconstruct state from session
    const currentState: OrchestratorState = {
      conversationHistory: (session.conversationHistory as any) || [],
      currentDocument: session.currentDocument || undefined,
      lastResearchResult: session.lastResearchResult as any,
    };

    // 8. Process message with orchestrator
    const orchestrator = createOrchestratorAgent();
    const result = await orchestrator.process(message, currentState);

    // 9. Update session
    const [updatedSession] = await db
      .update(orchestratorSessions)
      .set({
        conversationHistory: result.state.conversationHistory as any,
        currentDocument: result.state.currentDocument,
        lastResearchResult: result.state.lastResearchResult as any,
        creditsUsed: session.creditsUsed + result.creditsUsed,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorSessions.id, sessionId))
      .returning();

    // 10. Deduct credits
    await deductCredits(userId, result.creditsUsed);

    // 11. Get updated user credits
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
      totalCreditsUsed: updatedSession.creditsUsed,
      userCredits: updatedUser.credits,
      status: updatedSession.status,
    });
  } catch (error) {
    console.error('Error processing orchestrator message:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
