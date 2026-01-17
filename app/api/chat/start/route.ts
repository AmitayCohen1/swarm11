import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { getOrCreateUser } from '@/lib/credits';

/**
 * POST /api/chat/start
 * Creates a new chat session
 */
export async function POST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get or create user
    const user = await getOrCreateUser(clerkUserId, null);

    // Create new chat session
    const [session] = await db
      .insert(chatSessions)
      .values({
        userId: user.id,
        messages: [],
        brain: '',
        status: 'active',
        creditsUsed: 0,
        currentResearch: null
      })
      .returning();

    return NextResponse.json({
      sessionId: session.id,
      status: 'created',
      message: 'Chat session created successfully'
    });

  } catch (error: any) {
    console.error('Error creating chat session:', error);
    return NextResponse.json(
      { error: 'Failed to create chat session', details: error.message },
      { status: 500 }
    );
  }
}
