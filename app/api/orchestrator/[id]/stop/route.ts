import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { orchestratorSessions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOrCreateUser } from '@/lib/credits';

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

    // 2. Get user
    const user = await getOrCreateUser(clerkUserId, null);
    const userId = user.id;

    // 3. Update session status to stopped
    const [updatedSession] = await db
      .update(orchestratorSessions)
      .set({
        status: 'stopped',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orchestratorSessions.id, sessionId),
          eq(orchestratorSessions.userId, userId)
        )
      )
      .returning();

    if (!updatedSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      sessionId: updatedSession.id,
      status: updatedSession.status,
    });
  } catch (error) {
    console.error('Error stopping orchestrator session:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
