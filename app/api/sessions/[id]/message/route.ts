import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { chatSessions, users, researchSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeUserMessage } from '@/lib/agents/intake-agent';
import { runResearch } from '@/lib/research/run';

// export const maxDuration = 300; // 5 minutes

/**
 * POST /api/sessions/[id]/message
 * Send a message to the session (SSE stream)
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
  const sessionId = params.id;

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

    // Get session
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    if (!session) {
      return new Response('Session not found', { status: 404 });
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
      const offeredOptions = (lastMessage.metadata.options || []) as Array<{ label: string }>;
      const offeredLabels = offeredOptions.map(o => o.label).filter(Boolean);
      const selectedLabel = userMessage;
      const matched = offeredLabels.includes(selectedLabel);
      const unselectedLabels = offeredLabels.filter(l => l !== selectedLabel);

      conversationHistory.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString(),
        metadata: {
          type: 'option_selected',
          selectedOption: userMessage,
          offeredOptions,
          offeredOptionLabels: offeredLabels,
          unselectedOptionLabels: unselectedLabels,
          selectionMatchedOffered: matched,
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
      .where(eq(chatSessions.id, sessionId));

    // Create SSE stream
    const encoder = new TextEncoder();
    let streamClosed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          if (streamClosed) return; // Guard against sending after close
          try {
            const message = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (e) {
            streamClosed = true; // Mark as closed if enqueue fails
          }
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
            session.brain || '',
            (update) => sendEvent(update)
          );

          // Save search to DB if performed
          if (decision.searchPerformed) {
            const { query, answer } = decision.searchPerformed;
            console.log('[Route] Saving search to DB:', query);
            conversationHistory.push({
              role: 'assistant',
              content: `Looked up "${query}"`,
              timestamp: new Date().toISOString(),
              metadata: { type: 'intake_search', query, answer }
            });
            await db
              .update(chatSessions)
              .set({ messages: conversationHistory, updatedAt: new Date() })
              .where(eq(chatSessions.id, sessionId));
          }

          console.log('[Route] Decision type:', decision.type);

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
              .where(eq(chatSessions.id, sessionId));

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
              .where(eq(chatSessions.id, sessionId));

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

            await db
              .update(chatSessions)
              .set({
                status: 'researching',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, sessionId));

            // Create research session record
            const [researchSession] = await db
              .insert(researchSessions)
              .values({
                userId: user.id,
                chatSessionId: sessionId,
                objective: researchBrief.objective,
                successCriteria: researchBrief.successCriteria ? JSON.stringify(researchBrief.successCriteria) : null,
                status: 'running'
              })
              .returning({ id: researchSessions.id });

            const researchSessionId = researchSession.id;

            // Send confirmation message
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
              .where(eq(chatSessions.id, sessionId));

            sendEvent({
              type: 'research_started',
              objective: researchBrief.objective,
              brief: researchBrief
            });

            let researchResult: any = null;
            try {
              researchResult = await runResearch({
                chatSessionId: sessionId,
                researchBrief,
                onProgress: (update) => sendEvent(update)
              });
            } catch (researchError: any) {
              if (researchError.message === 'Research stopped by user') {
                await db
                  .update(researchSessions)
                  .set({ status: 'stopped', completedAt: new Date() })
                  .where(eq(researchSessions.id, researchSessionId));

                sendEvent({ type: 'message', message: 'Research stopped.', role: 'assistant' });
                sendEvent({ type: 'complete' });
                return;
              }
              throw researchError;
            }

            // Update research session with results
            const output = researchResult?.output;
            await db
              .update(researchSessions)
              .set({
                status: 'completed',
                finalAnswer: output?.finalAnswer,
                totalSteps: researchResult?.totalQuestions || 0,
                completedAt: new Date()
              })
              .where(eq(researchSessions.id, researchSessionId));

            // Get final answer
            const finalMessage = output?.finalAnswer?.trim() ||
              '**Research Complete**\n\nI\'ve finished researching this topic.';

            // Get current messages and append research result
            const [updatedSession] = await db
              .select({ messages: chatSessions.messages })
              .from(chatSessions)
              .where(eq(chatSessions.id, sessionId));

            // Add a context message so intake knows what just happened
            const researchContextMessage = {
              role: 'assistant',
              content: `[Research completed] Objective: ${researchBrief.objective}`,
              timestamp: new Date().toISOString(),
              metadata: { 
                type: 'research_context',
                objective: researchBrief.objective,
                summary: finalMessage.substring(0, 800)
              }
            };

            const updatedConversation = (updatedSession?.messages as any[] || []).concat([
              researchContextMessage,
              {
                role: 'assistant',
                content: finalMessage,
                timestamp: new Date().toISOString(),
                metadata: { kind: 'research_result' }
              }
            ]);

            // Add follow-up question
            const followUpQuestion = 'What would you like to do next?';
            const followUpOptions = [
              { label: 'Dive deeper' },
              { label: 'New research' },
              { label: 'Done for now' }
            ];

            updatedConversation.push({
              role: 'assistant',
              content: followUpQuestion,
              timestamp: new Date().toISOString(),
              metadata: { type: 'multi_choice_select', options: followUpOptions }
            });

            await db
              .update(chatSessions)
              .set({
                messages: updatedConversation,
                status: 'active',
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, sessionId));

            // Send research result
            sendEvent({
              type: 'message',
              message: finalMessage,
              role: 'assistant',
              metadata: { kind: 'research_result' }
            });

            // Send follow-up question
            sendEvent({
              type: 'multi_choice_select',
              question: followUpQuestion,
              options: followUpOptions
            });

            sendEvent({ type: 'complete' });
          }

        } catch (error: any) {
          console.error('Error processing message:', error);
          sendEvent({
            type: 'error',
            message: error.message || 'An error occurred'
          });
        } finally {
          streamClosed = true;
          controller.close();
        }
      },
      cancel() {
        streamClosed = true;
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
