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
            const assistantMessage = decision.message || 'Hello! How can I help?';

            conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
              timestamp: new Date().toISOString()
            });

            await db
              .update(chatSessions)
              .set({ messages: conversationHistory, updatedAt: new Date() })
              .where(eq(chatSessions.id, chatSessionId));

            sendEvent({ type: 'message', message: assistantMessage, role: 'assistant' });
            sendEvent({ type: 'complete' });

          } else if (decision.type === 'ask_clarification') {
            const question = decision.message || 'I need more information.';
            const options = decision.options || [];

            conversationHistory.push({
              role: 'assistant',
              content: question,
              timestamp: new Date().toISOString(),
              metadata: { type: 'ask_user', options }
            });

            await db
              .update(chatSessions)
              .set({ messages: conversationHistory, updatedAt: new Date() })
              .where(eq(chatSessions.id, chatSessionId));

            // Send as ask_user so UI renders clickable buttons
            sendEvent({ type: 'ask_user', question, options });
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

            // Get current brain and append new research section
            const [currentSession] = await db
              .select({ brain: chatSessions.brain })
              .from(chatSessions)
              .where(eq(chatSessions.id, chatSessionId));

            const currentBrain = currentSession?.brain || '';
            const separator = currentBrain ? '\n\n---\n\n' : '';
            const newBrainSection = `${separator}# ${researchBrief.objective}\n\n**Target:** ${researchBrief.targetProfile}\n**Success:** ${researchBrief.successCriteria}\n\n`;

            await db
              .update(chatSessions)
              .set({
                brain: currentBrain + newBrainSection,
                status: 'researching',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

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

            // Emit brain update with new section
            sendEvent({
              type: 'brain_update',
              brain: currentBrain + newBrainSection
            });

            let researchResult: any = null;
            try {
              researchResult = await executeResearch({
                chatSessionId,
                userId: user.id,
                researchBrief,
                conversationHistory,
                onProgress: (update) => {
                  // Stream progress as structured events (UI can show/hide details)
                  if (update.type === 'brain_update') {
                    // Pass through brain updates to frontend
                    sendEvent({
                      type: 'brain_update',
                      brain: update.brain
                    });
                  } else if (update.type === 'research_query') {
                    sendEvent(update);
                  } else if (update.type === 'search_result') {
                    sendEvent(update);
                  } else if (update.type === 'agent_thinking') {
                    sendEvent(update);
                  } else if (update.type === 'research_iteration') {
                    sendEvent(update);
                  }
                }
              });
              // (researchResult used below for final answer)
            } catch (researchError: any) {
              // Check if research was stopped by user
              if (researchError.message === 'Research stopped by user') {
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

            // Get final answer from structured output - typed by ResearchOutputSchema
            const [updatedSession] = await db
              .select({ messages: chatSessions.messages })
              .from(chatSessions)
              .where(eq(chatSessions.id, chatSessionId));

            const output = researchResult?.output;

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
