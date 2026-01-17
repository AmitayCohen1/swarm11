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
    const { message: userMessage } = await req.json();

    if (!userMessage?.trim()) {
      return new Response('Message is required', { status: 400 });
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
            // Check if user is approving a pending plan
            const pendingPlan = session.currentResearch as any;

            if (pendingPlan && pendingPlan.pendingApproval && (userMessage.toLowerCase().includes('yes') || userMessage.toLowerCase().includes('go') || userMessage.toLowerCase().includes('proceed'))) {
              // User approved the plan - start research
              sendEvent({
                type: 'message',
                message: "Great! Starting research now...",
                role: 'assistant'
              });

              conversationHistory.push({
                role: 'assistant',
                content: "Great! Starting research now...",
                timestamp: new Date().toISOString()
              });

              await db
                .update(chatSessions)
                .set({
                  messages: conversationHistory,
                  updatedAt: new Date()
                })
                .where(eq(chatSessions.id, chatSessionId));

              // Execute research with the approved plan
              const researchObjective = pendingPlan.objective;

              sendEvent({
                type: 'research_started',
                objective: researchObjective
              });

              // Emit brain clear at start of research
              sendEvent({
                type: 'brain_update',
                brain: ''
              });

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

            } else {
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
            }

          } else if (decision.type === 'propose_plan') {
            // Show the research plan and ask for approval
            const researchObjective = decision.researchObjective || userMessage;
            const plan = decision.plan;

            let planMessage = `I've created a research plan:\n\n`;
            planMessage += `**Strategy:** ${plan?.strategy || 'Systematic research approach'}\n\n`;
            planMessage += `**Questions I'll investigate:**\n`;
            plan?.questions?.forEach((q, i) => {
              planMessage += `${i + 1}. ${q}\n`;
            });
            planMessage += `\nShould I proceed with this research?`;

            // Store pending plan for approval and CLEAR old brain
            await db
              .update(chatSessions)
              .set({
                currentResearch: {
                  pendingApproval: true,
                  objective: researchObjective,
                  plan: plan
                },
                brain: '', // Clear old research data
                updatedAt: new Date()
              })
              .where(eq(chatSessions.id, chatSessionId));

            // Clear brain in UI
            sendEvent({
              type: 'brain_update',
              brain: ''
            });

            // Add plan message to conversation
            conversationHistory.push({
              role: 'assistant',
              content: planMessage,
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
              message: planMessage,
              role: 'assistant'
            });

            sendEvent({
              type: 'complete'
            });

          } else if (false) {
            // Old start_research code - keeping structure
            const researchObjective = decision.researchObjective || userMessage;

            sendEvent({
              type: 'research_started',
              objective: researchObjective
            });

            // Execute research with progress callbacks
            const result = await executeResearch({
              chatSessionId,
              userId: user.id,
              researchObjective,
              onProgress: (update) => {
                sendEvent(update);
              }
            });

            // Get final brain content
            const [updatedSession] = await db
              .select({ brain: chatSessions.brain, messages: chatSessions.messages })
              .from(chatSessions)
              .where(eq(chatSessions.id, chatSessionId));

            const updatedMessages = updatedSession?.messages as any[] || conversationHistory;

            // Check if research needs clarification
            if (result.needsClarification) {
              // Agent is asking a question
              const clarificationMessage = `I've made progress on the research, but I need your input to continue effectively.\n\n**Context:** ${result.context || 'Research in progress'}\n\n**Question:** ${result.question || 'Need clarification'}`;

              updatedMessages.push({
                role: 'assistant',
                content: clarificationMessage,
                timestamp: new Date().toISOString(),
                metadata: {
                  type: 'clarification_request',
                  iterations: result.iterations,
                  creditsUsed: result.creditsUsed
                }
              });

              await db
                .update(chatSessions)
                .set({
                  messages: updatedMessages,
                  updatedAt: new Date()
                })
                .where(eq(chatSessions.id, chatSessionId));

              sendEvent({
                type: 'message',
                message: clarificationMessage,
                role: 'assistant',
                metadata: {
                  type: 'clarification_request',
                  iterations: result.iterations,
                  creditsUsed: result.creditsUsed
                }
              });

              sendEvent({
                type: 'complete'
              });
            } else {
              // Research completed normally
              const researchSummary = `I've completed research on: "${researchObjective}"\n\nKey findings have been added to our shared knowledge base. Here's what I found:\n\n${updatedSession?.brain?.substring(updatedSession.brain.length - 1000) || 'Research completed.'}`;

              updatedMessages.push({
                role: 'assistant',
                content: researchSummary,
                timestamp: new Date().toISOString(),
                metadata: {
                  type: 'research_complete',
                  iterations: result.iterations,
                  creditsUsed: result.creditsUsed
                }
              });

              await db
                .update(chatSessions)
                .set({
                  messages: updatedMessages,
                  updatedAt: new Date()
                })
                .where(eq(chatSessions.id, chatSessionId));

              sendEvent({
                type: 'message',
                message: researchSummary,
                role: 'assistant',
                metadata: {
                  iterations: result.iterations,
                  creditsUsed: result.creditsUsed
                }
              });

              sendEvent({
                type: 'complete'
              });
            }
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
