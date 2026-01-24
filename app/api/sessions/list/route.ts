import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

const PAGE_SIZE = 20;

/**
 * GET /api/sessions/list
 * Fetch paginated sessions for the current user
 * Query params: ?page=1 (1-indexed)
 */
export async function GET(req: NextRequest) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  try {
    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkUserId));

    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(chatSessions)
      .where(eq(chatSessions.userId, user.id));

    const total = Number(count);
    const totalPages = Math.ceil(total / PAGE_SIZE);

    // Fetch paginated sessions
    const sessions = await db
      .select({
        id: chatSessions.id,
        messages: chatSessions.messages,
        status: chatSessions.status,
        creditsUsed: chatSessions.creditsUsed,
        createdAt: chatSessions.createdAt,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.userId, user.id))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    // Transform sessions to include preview info
    const sessionsWithMeta = sessions.map((session) => {
      const messages = session.messages as any[] || [];
      const firstUserMessage = messages.find((m: any) => m.role === 'user');
      const title = firstUserMessage?.content?.substring(0, 100) || 'Untitled session';

      return {
        id: session.id,
        title: title.length === 100 ? title + '...' : title,
        status: session.status,
        creditsUsed: session.creditsUsed,
        messageCount: messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });

    return Response.json({
      sessions: sessionsWithMeta,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total,
        totalPages,
        hasMore: page < totalPages,
      }
    });

  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch sessions' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
