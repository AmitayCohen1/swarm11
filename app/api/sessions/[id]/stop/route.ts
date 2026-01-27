import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { stopResearch } from '@/lib/research/run';

/**
 * POST /api/sessions/[id]/stop
 * Stops ongoing research in a session
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const sessionId = params.id;

  try {
    // Get session
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Actually stop the running research process
    const wasStopped = stopResearch(sessionId);

    // Update DB state
    await db
      .update(chatSessions)
      .set({
        status: 'active',
        currentResearch: null,
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, sessionId));

    return NextResponse.json({
      status: 'stopped',
      message: wasStopped
        ? 'Research stopped successfully'
        : 'No active research found (may have already completed)'
    });

  } catch (error: any) {
    console.error('Error stopping research:', error);
    return NextResponse.json(
      { error: 'Failed to stop research', details: error.message },
      { status: 500 }
    );
  }
}
