import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orchestratorSessions, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOrCreateUser } from '@/lib/credits';

export async function GET(
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

    // 2. Get user
    const user = await getOrCreateUser(clerkUserId, null);
    const userId = user.id;

    // 3. Get session
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

    // 4. Get user credits
    const [userWithCredits] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        creditsUsed: session.creditsUsed,
        conversationHistory: session.conversationHistory,
        currentDocument: session.currentDocument,
        lastResearchResult: session.lastResearchResult,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      userCredits: userWithCredits.credits,
    });
  } catch (error) {
    console.error('Error fetching orchestrator session:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
