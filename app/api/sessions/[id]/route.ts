import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/sessions/[id]
 * Fetch a specific session by ID
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = await context.params;
  const sessionId = params.id;

  try {
    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkUserId));

    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    // Fetch the session, ensuring it belongs to this user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.userId, user.id)
        )
      );

    if (!session) {
      return new Response('Session not found', { status: 404 });
    }

    return Response.json({ session });

  } catch (error: any) {
    console.error('Error fetching session:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch session' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * DELETE /api/sessions/[id]
 * Delete a specific session
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = await context.params;
  const sessionId = params.id;

  try {
    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkUserId));

    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    // Delete the session, ensuring it belongs to this user
    const result = await db
      .delete(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.userId, user.id)
        )
      )
      .returning({ id: chatSessions.id });

    if (result.length === 0) {
      return new Response('Session not found', { status: 404 });
    }

    return Response.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting session:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete session' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
