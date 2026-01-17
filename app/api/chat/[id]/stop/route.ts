import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/chat/[id]/stop
 * Stops ongoing research in a chat session
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
  const chatSessionId = params.id;

  try {
    // Get chat session
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    if (!session) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 });
    }

    // Stop research by clearing current research state
    await db
      .update(chatSessions)
      .set({
        status: 'active',
        currentResearch: null,
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, chatSessionId));

    return NextResponse.json({
      status: 'stopped',
      message: 'Research stopped successfully'
    });

  } catch (error: any) {
    console.error('Error stopping research:', error);
    return NextResponse.json(
      { error: 'Failed to stop research', details: error.message },
      { status: 500 }
    );
  }
}
