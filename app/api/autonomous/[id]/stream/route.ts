import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { autonomousSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createAndRunAutonomousAgent } from '@/lib/agents/autonomous-agent';

export const maxDuration = 300; // 5 minutes per execution

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

  // Get session
  const [session] = await db
    .select()
    .from(autonomousSessions)
    .where(eq(autonomousSessions.id, sessionId));

  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE event
      const sendEvent = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Run agent (this is the autonomous loop!)
        const result = await createAndRunAutonomousAgent({
          sessionId: session.id,
          userId: session.userId,
          objective: session.objective,
          maxIterations: session.maxQueries,
          onProgress: (update) => {
            sendEvent(update);
          }
        });

        // Send completion event
        sendEvent({
          type: 'completed',
          finalReport: result.finalReport,
          stopReason: result.stopReason,
          totalSteps: result.totalSteps,
          creditsUsed: result.creditsUsed
        });

      } catch (error: any) {
        console.error('Agent execution error:', error);

        sendEvent({
          type: 'error',
          message: error.message || 'Unknown error occurred'
        });

        // Mark session as failed
        await db
          .update(autonomousSessions)
          .set({
            status: 'failed',
            stopReason: 'error'
          })
          .where(eq(autonomousSessions.id, sessionId));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    }
  });
}
