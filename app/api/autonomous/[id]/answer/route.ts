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
    const { answer } = await req.json();

    if (!answer?.trim()) {
      return NextResponse.json({ error: 'Answer required' }, { status: 400 });
    }

    // Update session with user's answer and set status back to active
    const [updatedSession] = await db
      .update(autonomousSessions)
      .set({
        status: 'active',
        pendingResponse: answer,
        updatedAt: new Date()
      })
      .where(eq(autonomousSessions.id, sessionId))
      .returning();

    if (!updatedSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      sessionId: updatedSession.id,
      status: updatedSession.status
    });
  } catch (error: any) {
    console.error('Error submitting clarification answer:', error);
    return NextResponse.json({
      error: 'Failed to submit answer',
      details: error.message
    }, { status: 500 });
  }
}
