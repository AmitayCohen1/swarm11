import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * DELETE /api/sessions/delete-all
 * Delete all sessions for the current user
 */
export async function DELETE(req: NextRequest) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkUserId));

    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    // Delete all sessions for this user
    const result = await db
      .delete(chatSessions)
      .where(eq(chatSessions.userId, user.id))
      .returning({ id: chatSessions.id });

    return Response.json({
      success: true,
      deletedCount: result.length
    });

  } catch (error: any) {
    console.error('Error deleting all sessions:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete sessions' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
