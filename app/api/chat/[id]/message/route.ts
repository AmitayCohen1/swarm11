import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeUserMessage } from '@/lib/agents/orchestrator-chat-agent';
import { executeResearch } from '@/lib/agents/research-executor-agent';

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
    conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

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
          if (decision.type === 'chat_response') {
            // Regular chat response
            const assistantMessage = decision.message || 'I need more information to help you.';

            conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
              timestamp: new Date().toISOString()
            });

            await db
              .update(chatSessions)
              .set({
                messages: conversationHistory,
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            sendEvent({
              type: 'message',
              message: assistantMessage,
              role: 'assistant'
            });

            sendEvent({
              type: 'complete'
            });

          } else if (decision.type === 'start_research') {
            // Start research immediately - no plan approval needed
            const researchObjective = decision.researchObjective || userMessage;

            // Clear old brain and set status to researching
            await db
              .update(chatSessions)
              .set({
                brain: '',
                status: 'researching',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            // Send confirmation message if provided, otherwise default message
            const startMessage = decision.confirmationMessage || "Starting research now...";

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
              objective: researchObjective
            });

            // Emit brain clear at start of research
            sendEvent({
              type: 'brain_update',
              brain: ''
            });

            try {
              const result = await executeResearch({
                chatSessionId,
                userId: user.id,
                researchObjective,
                onProgress: (update) => {
                  // Convert progress to chat messages - full transparency
                  if (update.type === 'brain_update') {
                    // Pass through brain updates to frontend
                    sendEvent({
                      type: 'brain_update',
                      brain: update.brain
                    });
                  } else if (update.type === 'research_query') {
                    sendEvent({
                      type: 'message',
                      message: `🔍 **Searching:** "${update.query}"`,
                      role: 'assistant'
                    });
                  } else if (update.type === 'search_result') {
                    // Show the full search result with sources
                    let resultMessage = `📄 **Search Result:**\n\n---\n\n${update.answer}`;

                    // Add sources if available
                    if (update.sources && update.sources.length > 0) {
                      resultMessage += `\n\n---\n\n**📚 Sources:**\n`;
                      update.sources.forEach((source: any, idx: number) => {
                        if (typeof source === 'string') {
                          resultMessage += `${idx + 1}. ${source}\n`;
                        } else if (source.url) {
                          resultMessage += `${idx + 1}. [${source.title || source.url}](${source.url})\n`;
                        }
                      });
                    }

                    sendEvent({
                      type: 'message',
                      message: resultMessage,
                      role: 'assistant'
                    });
                  } else if (update.type === 'agent_thinking') {
                    sendEvent({
                      type: 'message',
                      message: `💭 **Agent Reasoning:** ${update.thinking}`,
                      role: 'assistant'
                    });
                  }
                }
              });
            } catch (researchError: any) {
              // Check if research was stopped by user
              if (researchError.message === 'Research stopped by user') {
                sendEvent({
                  type: 'message',
                  message: '⏸️ **Research stopped**',
                  role: 'assistant'
                });
                sendEvent({
                  type: 'complete'
                });
                return; // Exit early
              }
              // Re-throw other errors to be caught by outer catch
              throw researchError;
            }

            // Get final brain
            const [updatedSession] = await db
              .select({ brain: chatSessions.brain, messages: chatSessions.messages })
              .from(chatSessions)
              .where(eq(chatSessions.id, chatSessionId));

            const finalMessage = `✅ **Research Complete**\n\nHere's what I found:\n\n${updatedSession?.brain?.substring(updatedSession.brain.length - 2000) || 'Research completed.'}`;

            const updatedMessages = updatedSession?.messages as any[] || conversationHistory;
            updatedMessages.push({
              role: 'assistant',
              content: finalMessage,
              timestamp: new Date().toISOString()
            });

            await db
              .update(chatSessions)
              .set({
                messages: updatedMessages,
                status: 'active', // Research complete, back to active
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            sendEvent({
              type: 'message',
              message: finalMessage,
              role: 'assistant'
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
