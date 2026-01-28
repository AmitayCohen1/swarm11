import { NextRequest } from 'next/server';
import { runResearch } from '@/lib/research/runner';
import { ResearchState } from '@/lib/research/types';

/**
 * POST /api/tree-research
 * Test endpoint for tree-based research
 *
 * Body: { objective: string, successCriteria?: string[] }
 * Returns: SSE stream of progress events
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { objective, successCriteria } = body;

    if (!objective?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Objective is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    let streamClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          if (streamClosed) return;
          try {
            const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (e) {
            streamClosed = true;
          }
        };

        try {
          sendEvent('started', { objective, successCriteria });

          const result = await runResearch(objective, successCriteria, {
            onStateChange: async (state: ResearchState) => {
              sendEvent('state_update', {
                nodeCount: Object.keys(state.nodes).length,
                status: state.status,
                nodes: Object.values(state.nodes).map(n => ({
                  id: n.id,
                  parentId: n.parentId,
                  question: n.question,
                  status: n.status,
                  hasResult: !!n.answer,
                })),
              });
            },

            onNodeStart: (node) => {
              sendEvent('node_start', {
                nodeId: node.id,
                parentId: node.parentId,
                question: node.question,
                reason: node.reason,
              });
            },

            onNodeComplete: (node) => {
              sendEvent('node_complete', {
                nodeId: node.id,
                question: node.question,
                confidence: node.confidence,
                answerLength: node.answer?.length || 0,
                answerPreview: node.answer?.substring(0, 200) + '...',
              });
            },

            onDecision: (decision, reasoning) => {
              sendEvent('brain_decision', { decision, reasoning });
            },
          });

          // Send final result
          sendEvent('complete', {
            finalAnswer: result.finalAnswer,
            totalNodes: Object.keys(result.nodes).length,
            tree: Object.values(result.nodes).map(n => ({
              id: n.id,
              parentId: n.parentId,
              question: n.question,
              reason: n.reason,
              status: n.status,
              confidence: n.confidence,
              answer: n.answer,
            })),
          });

        } catch (error: any) {
          console.error('Tree research error:', error);
          sendEvent('error', { message: error.message || 'Unknown error' });
        } finally {
          streamClosed = true;
          controller.close();
        }
      },
      cancel() {
        streamClosed = true;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Error in tree-research route:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start research', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
