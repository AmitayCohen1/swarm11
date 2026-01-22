import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users, researchSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeUserMessage } from '@/lib/agents/orchestrator-chat-agent';
import { executeResearch } from '@/lib/agents/research-executor-agent';
import {
  createResearchDoc,
  serializeDoc
} from '@/lib/utils/doc-operations';

export const maxDuration = 300; // 5 minutes

/**
 * POST /api/chat/[id]/message
 * Send a message to the chat session (SSE stream)
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = await context.params;
  const chatSessionId = params.id;

  try {
    // Parse JSON with error handling
    let body;
    try {
      body = await req.json();
    } catch (jsonError) {
      console.error('Failed to parse request body:', jsonError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { message: userMessage } = body;

    if (!userMessage?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get chat session
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, chatSessionId));

    if (!session) {
      return new Response('Chat session not found', { status: 404 });
    }

    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId));

    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    // Add user message to conversation
    const conversationHistory = session.messages as any[] || [];

    // Check if this is a response to a multi_choice_select
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    const isResponseToOptions = lastMessage?.metadata?.type === 'multi_choice_select';

    if (isResponseToOptions) {
      // Store with context about what was offered and selected
      conversationHistory.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'option_selected',
          selectedOption: userMessage,
          offeredOptions: lastMessage.metadata.options,
          originalQuestion: lastMessage.content
        }
      });
    } else {
      conversationHistory.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      });
    }

    await db
      .update(chatSessions)
      .set({
        messages: conversationHistory,
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, chatSessionId));

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        try {
          // Orchestrator analyzes the message
          sendEvent({
            type: 'analyzing',
            message: 'Analyzing your message...'
          });

          const decision = await analyzeUserMessage(
            userMessage,
            conversationHistory,
            session.brain || ''
          );

          sendEvent({
            type: 'decision',
            decision: decision.type,
            reasoning: decision.reasoning
          });

          // Handle decision
          if (decision.type === 'text_input') {
            const assistantMessage = decision.message || 'Hello! How can I help?';
            const reason = decision.reason;

            conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
              timestamp: new Date().toISOString(),
              metadata: reason ? { reason } : undefined
            });

            await db
              .update(chatSessions)
              .set({ messages: conversationHistory, updatedAt: new Date() })
              .where(eq(chatSessions.id, chatSessionId));

            sendEvent({ type: 'message', message: assistantMessage, role: 'assistant', reason });
            sendEvent({ type: 'complete' });

          } else if (decision.type === 'multi_choice_select') {
            const question = decision.message || 'Please select an option:';
            const options = decision.options || [];
            const reason = decision.reason;

            conversationHistory.push({
              role: 'assistant',
              content: question,
              timestamp: new Date().toISOString(),
              metadata: { type: 'multi_choice_select', options, reason }
            });

            await db
              .update(chatSessions)
              .set({ messages: conversationHistory, updatedAt: new Date() })
              .where(eq(chatSessions.id, chatSessionId));

            // Send as multi_choice_select so UI renders clickable buttons
            sendEvent({ type: 'multi_choice_select', question, options, reason });
            sendEvent({ type: 'complete' });

          } else if (decision.type === 'start_research') {
            // Start research with structured brief
            const researchBrief = decision.researchBrief;

            if (!researchBrief) {
              sendEvent({ type: 'error', message: 'Research brief missing from orchestrator decision' });
              sendEvent({ type: 'complete' });
              return;
            }

            // POC: Credit checks disabled - free to use
            // TODO: Enable credit checks before production launch

            // Initialize research document with initial strategy from orchestrator
            const newDoc = createResearchDoc(
              researchBrief.objective,
              researchBrief.doneWhen,
              researchBrief.initialStrategy
            );
            const serializedBrain = serializeDoc(newDoc);

            await db
              .update(chatSessions)
              .set({
                brain: serializedBrain,
                status: 'researching',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            // Create research session record
            const [researchSession] = await db
              .insert(researchSessions)
              .values({
                userId: user.id,
                chatSessionId,
                objective: researchBrief.objective,
                status: 'running'
              })
              .returning({ id: researchSessions.id });

            const researchSessionId = researchSession.id;

            // Send confirmation message if provided, otherwise default message
            const startMessage = decision.message || "Starting research now...";

            sendEvent({
              type: 'message',
              message: startMessage,
              role: 'assistant'
            });

            conversationHistory.push({
              role: 'assistant',
              content: startMessage,
              timestamp: new Date().toISOString()
            });

            await db
              .update(chatSessions)
              .set({
                messages: conversationHistory,
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            // Start research
            sendEvent({
              type: 'research_started',
              objective: researchBrief.objective,
              brief: researchBrief
            });

            // Emit brain update with new structured memory
            sendEvent({
              type: 'brain_update',
              brain: serializedBrain
            });

            let researchResult: any = null;
            try {
              researchResult = await executeResearch({
                chatSessionId,
                researchSessionId,
                userId: user.id,
                researchBrief,
                conversationHistory,
                existingBrain: serializedBrain,
                onProgress: (update) => {
                  // Forward all progress events to frontend
                  sendEvent(update);
                }
              });
              // (researchResult used below for final answer)
            } catch (researchError: any) {
              // Check if research was stopped by user
              if (researchError.message === 'Research stopped by user') {
                // Update research session status
                await db
                  .update(researchSessions)
                  .set({ status: 'stopped', completedAt: new Date() })
                  .where(eq(researchSessions.id, researchSessionId));

                sendEvent({
                  type: 'message',
                  message: 'Research stopped.',
                  role: 'assistant',
                  metadata: { researchStep: 'stopped' }
                });
                sendEvent({
                  type: 'complete'
                });
                return; // Exit early
              }

              // POC: Credit error handling disabled

              // Re-throw other errors to be caught by outer catch
              throw researchError;
            }

            // Update research session with results
            const output = researchResult?.output;
            await db
              .update(researchSessions)
              .set({
                status: 'completed',
                confidenceLevel: output?.confidenceLevel,
                finalAnswer: output?.finalAnswer,
                totalSteps: researchResult?.iterations || 0,
                totalCost: researchResult?.creditsUsed || 0,
                completedAt: new Date()
              })
              .where(eq(researchSessions.id, researchSessionId));

            // Get final answer from structured output - typed by ResearchOutputSchema
            const [updatedSession] = await db
              .select({ messages: chatSessions.messages })
              .from(chatSessions)
              .where(eq(chatSessions.id, chatSessionId));

            // Build final message from structured output
            let finalMessage = '';

            if (output?.finalAnswer?.trim()) {
              // Primary: use the finalAnswer markdown
              finalMessage = output.finalAnswer.trim();
            } else if (output?.keyFindings?.length || output?.recommendedActions?.length) {
              // Fallback: build from structured fields
              const parts: string[] = ['**Research Complete**\n'];

              if (output.keyFindings?.length) {
                parts.push('**Key Findings:**');
                output.keyFindings.forEach((f: string) => parts.push(`- ${f}`));
                parts.push('');
              }

              if (output.recommendedActions?.length) {
                parts.push('**Recommended Actions:**');
                output.recommendedActions.forEach((a: string) => parts.push(`- ${a}`));
              }

              finalMessage = parts.join('\n');
            } else {
              finalMessage = '**Research Complete**\n\nI\'ve finished researching this topic. Check the findings above for details.';
            }

            const updatedConversation = (updatedSession?.messages as any[] || []).concat([{
              role: 'assistant',
              content: finalMessage,
              timestamp: new Date().toISOString()
            }]);

            await db
              .update(chatSessions)
              .set({
                messages: updatedConversation,
                status: 'active',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            sendEvent({
              type: 'message',
              message: finalMessage,
              role: 'assistant',
              metadata: { kind: 'final' }
            });

            sendEvent({
              type: 'complete'
            });
          }

        } catch (error: any) {
          console.error('Error processing message:', error);
          sendEvent({
            type: 'error',
            message: error.message || 'An error occurred'
          });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error: any) {
    console.error('Error in message route:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process message', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
