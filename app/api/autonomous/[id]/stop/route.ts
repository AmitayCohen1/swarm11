import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const sessionId = params.id;

    // Update session to stopped
    const [updatedSession] = await db
      .update(autonomousSessions)
      .set({
        status: 'stopped',
        stopReason: 'user_stopped',
        completedAt: new Date()
      })
      .where(eq(autonomousSessions.id, sessionId))
      .returning();

    if (!updatedSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      status: 'stopped',
      sessionId: updatedSession.id
    });
  } catch (error: any) {
    console.error('Error stopping session:', error);
    return NextResponse.json({
      error: 'Failed to stop session',
      details: error.message
    }, { status: 500 });
  }
}
