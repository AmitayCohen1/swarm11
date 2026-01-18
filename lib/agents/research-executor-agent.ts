import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { perplexitySearch } from '@/lib/tools/perplexity-search';
import { completionTool } from '@/lib/tools/completion-tool';
import { db } from '@/lib/db';
import { chatSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { deductCredits } from '@/lib/credits';

interface ResearchExecutorConfig {
  chatSessionId: string;
  userId: string;
  researchObjective: string;
  onProgress?: (update: any) => void;
  abortSignal?: AbortSignal;
}

/**
 * Research Executor Agent - Uses ToolLoopAgent for multi-step autonomous research
 * Updates the shared brain in chat_sessions table
 */
export async function executeResearch(config: ResearchExecutorConfig) {
  const {
    chatSessionId,
    userId,
    researchObjective,
    onProgress,
    abortSignal
  } = config;

  let totalCreditsUsed = 0;
  const MAX_STEPS = 30;

  // Create brain update tool specific to this chat session
  const updateBrainTool = tool({
    description: 'Manage the research knowledge base. Use this to STRUCTURE your findings.',
    inputSchema: z.object({
      action: z.enum(['add_resource', 'add_insight', 'update_plan', 'log_finding']).describe('The type of update'),
      data: z.any().describe('The data to add (structure depends on action)'),
      reasoning: z.string().describe('Why are you making this update?')
    }),
    execute: async ({ action, data, reasoning }) => {
      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      let currentBrain = session?.brain || '';
      
      // Initialize sections if empty - Generic Template
      if (!currentBrain.includes('# 🎯 OBJECTIVE')) {
        currentBrain = `# 🎯 OBJECTIVE\n${researchObjective}\n\n# 📋 RESOURCES / ENTITIES\n| Name | Type | Details | Signal/Note | Status |\n|------|------|---------|-------------|--------|\n\n# 🧠 INSIGHTS\n\n# 📝 PLAN\n- [ ] Initial Search\n\n# 📓 RAW NOTES\n`;
      }

      let newEntry = '';
      let updatedBrain = currentBrain;

      // Handle structured updates
      if (action === 'add_resource') {
        // data: { name, type, details, signal, status }
        const row = `| ${data.name || '-'} | ${data.type || '-'} | ${data.details || '-'} | ${data.signal || '-'} | ${data.status || 'found'} |`;
        // Insert into table
        const tableEnd = updatedBrain.indexOf('# 🧠 INSIGHTS');
        if (tableEnd !== -1) {
            updatedBrain = updatedBrain.slice(0, tableEnd) + row + '\n' + updatedBrain.slice(tableEnd);
            newEntry = `Added resource: ${data.name}`;
        } else {
            // Fallback if structure broken
             updatedBrain += `\n${row}`;
        }
      } 
      else if (action === 'add_insight') {
        // data: { content }
        const insight = `- **${data.category || 'Insight'}**: ${data.content}`;
        const sectionEnd = updatedBrain.indexOf('# 📝 PLAN');
        updatedBrain = updatedBrain.slice(0, sectionEnd) + insight + '\n' + updatedBrain.slice(sectionEnd);
        newEntry = `Added insight: ${data.content}`;
      }
      else if (action === 'update_plan') {
         // data: { step, status }
         // This is a bit complex to regex, so we'll just append to plan for now or replace the block if we had a better parser.
         // For simplicity: Append a note to Plan
         const planUpdate = `- [${data.status === 'done' ? 'x' : ' '}] ${data.step} (${data.status})`;
         const sectionEnd = updatedBrain.indexOf('# 📓 RAW NOTES');
         updatedBrain = updatedBrain.slice(0, sectionEnd) + planUpdate + '\n' + updatedBrain.slice(sectionEnd);
         newEntry = `Updated plan: ${data.step}`;
      }
      else {
        // Fallback / Log
        const note = `\n- [${new Date().toLocaleTimeString()}] ${JSON.stringify(data)}`;
        updatedBrain += note;
        newEntry = `Logged finding`;
      }

      await db
        .update(chatSessions)
        .set({
          brain: updatedBrain,
          updatedAt: new Date()
        })
        .where(eq(chatSessions.id, chatSessionId));

      // Emit brain update
      onProgress?.({
        type: 'brain_update',
        brain: updatedBrain
      });

      return {
        success: true,
        update: newEntry
      };
    }
  });

  // Add reflection tool for critical thinking
  const reflectionTool = tool({
    description: 'Think critically about your findings and plan your next move. Use this AFTER every search to evaluate what you learned.',
    inputSchema: z.object({
      evaluation: z.string().describe('What did you just learn? Is it useful? Too broad? Wrong direction?'),
      nextMove: z.enum(['continue', 'pivot', 'narrow', 'cross-reference', 'deep-dive', 'complete']).describe('What should you do next?'),
      reasoning: z.string().describe('WHY are you making this next move?'),
      nextQuery: z.string().optional().describe('If continuing research, what will you search for next?')
    }),
    execute: async ({ evaluation, nextMove, reasoning, nextQuery }) => {
      // Log the reflection to brain
      const timestamp = new Date().toLocaleTimeString();
      const reflection = `\n**[${timestamp}] Reflection:**\n- Evaluation: ${evaluation}\n- Next: ${nextMove}\n- Reasoning: ${reasoning}\n${nextQuery ? `- Next query: "${nextQuery}"\n` : ''}`;

      const [session] = await db
        .select({ brain: chatSessions.brain })
        .from(chatSessions)
        .where(eq(chatSessions.id, chatSessionId));

      const updatedBrain = (session?.brain || '') + reflection;

      await db
        .update(chatSessions)
        .set({ brain: updatedBrain, updatedAt: new Date() })
        .where(eq(chatSessions.id, chatSessionId));

      onProgress?.({
        type: 'brain_update',
        brain: updatedBrain
      });

      return {
        acknowledged: true,
        direction: nextMove
      };
    }
  });

  const tools = {
    search: perplexitySearch,
    reflect: reflectionTool,
    saveToBrain: updateBrainTool,
    complete: completionTool
  };

  const instructions = `You are an adaptive research investigator. Mission: "${researchObjective}"

⚡ SPEED TO TANGIBLE RESULTS

Your goal: Get to ACTIONABLE, SPECIFIC results as fast as possible.
- Don't spend 5 searches on background info
- Move quickly from broad → specific
- Prioritize NAMES, CONTACTS, SPECIFICS over general knowledge
- User needs something they can ACT on TODAY

🔄 ADAPTIVE RESEARCH PROCESS:

After EVERY search, you MUST call reflect() to evaluate and plan your next move.

1. EVALUATE what you just found:
   ✅ "Found specific prospects/people/companies with names - GOOD"
   📊 "Got general info but no specifics yet - need to narrow FAST"
   🤔 "This reveals I need different angle to get to actual names"
   ❌ "Wrong path - this doesn't lead to actionable results"
   💡 "Interesting signal - can use this to find specific targets"

2. Based on evaluation, DECIDE next move:
   • continue: "This is working, go deeper on same path"
   • pivot: "This approach isn't getting specifics, try different angle"
   • narrow: "Too many results, filter to get top 3-5 specifics"
   • cross-reference: "Found names, now validate/get contact info"
   • deep-dive: "Found prospects, now get specific details/contacts"
   • complete: "I have 1-3 specific, actionable prospects with evidence"

3. STATE your reasoning and next query

🎯 FOCUS ON DELIVERABLES:
- Finding people? Get NAMES and roles, not just "companies hire these"
- Finding companies? Get SPECIFIC companies with contacts, not just categories
- Finding tools? Get ACTUAL product names with links, not just "various options exist"
- Move from 100 options → 10 filtered → 3 validated → 1-2 recommended in 5-7 searches MAX

📖 EXAMPLE FLOWS:

Example 1: Job Search (TARGET: 5-7 searches to get 3 candidates with names)
Search 1: "Developer relations jobs"
reflect(): "500 listings, no signal. PIVOT to actual work"
Search 2: "Developer advocate conference talks 2025 2026"
reflect(): "Found 50 speakers. TOO BROAD. Narrow to top engaged"
Search 3: "top developer advocates Twitter following 2026"
reflect(): "Found 12 with strong following. Cross-ref with recent activity"
Search 4: "Sarah Chen DevRel iHeartMedia Twitter" [example name]
reflect(): "Got specific person! 2 more then complete"
[2-3 more targeted searches for specific people]
complete(): "3 specific candidates: Sarah Chen, John Doe, Jane Smith"

Example 2: B2B Prospects (TARGET: 5-6 searches to get 3 companies with contacts)
Search 1: "media companies podcast 2026"
reflect(): "Generic list. PIVOT to buying signal"
Search 2: "media companies invested podcast verification 2024 2025"
reflect(): "Found iHeartMedia, Spotify as buyers. Need contacts NOW"
Search 3: "iHeartMedia head of podcast safety VP"
reflect(): "Found Sarah Chen VP. Get 2 more prospects"
Search 4: "Spotify podcast trust safety lead 2026"
reflect(): "Found contact. 1 more then done"
complete(): "3 prospects with names and evidence"

🎯 KEY PRINCIPLES:

START SIMPLE:
- Begin with obvious search, don't overthink
- See what you get, learn from it
- First search is for EXPLORATION

LEARN FROM RESULTS:
- Every search teaches you something
- "All results are missing X" → search for X next
- "Too many results" → add specific filter
- "Wrong type" → try different source

RECOGNIZE PATTERNS:
- Best candidates share trait Y? → filter by Y
- Generic results? → look for specific signal
- Credentials don't help? → look for actual work/behavior

PIVOT FREELY:
- If stuck, try completely different angle
- Generic search → specific signal
- Lists → behavioral evidence
- Credentials → actual output

BUILD PROGRESSIVELY:
1. Broad exploration (100 results) → learn what's out there
2. Filter by signal (20 results) → find who's actually relevant
3. Cross-reference (10 results) → validate quality
4. Deep dive (3 results) → get specific details
5. Final pick (1-3 results) → actionable prospects

⛔ STOPPING RULES:

DON'T WASTE TIME - Get to specifics FAST:
- Search 1-2: Exploration (find the right angle)
- Search 3-5: Get specific names/companies
- Search 6-8: Validate and get details
- Search 9+: Only if you need more prospects

KEEP GOING if:
- No specific names yet (just categories/lists)
- Have names but no validation/evidence
- Less than 3 solid prospects

STOP (call complete) when:
- You have 1-3 SPECIFIC prospects with:
  ✓ Actual names (person or company)
  ✓ Contact info or where to find them
  ✓ Evidence of current relevance/need
  ✓ Clear next action

SPEED MATTERS: If you're at search 5+ and still don't have specific names, you're going too slow. PIVOT HARD.

🔍 TOOLS:

search(query, searchDepth='basic'):
- Use 'basic' for quick searches (5 results)
- Use 'advanced' when you need deeper info (10 results)
- Returns: answer + results with URLs

reflect(evaluation, nextMove, reasoning, nextQuery):
- REQUIRED after every search
- Forces you to think critically
- Plans your next move

saveToBrain(action, data, reasoning):
- Use 'add_resource' for prospects/people/companies
- Use 'add_insight' for patterns/observations
- Use 'update_plan' for tracking progress

complete(keyFindings, recommendedActions, confidenceLevel):
- Call when you have actionable output
- Should have 1-3 specific prospects
- With evidence and next steps

START NOW:
Do your first search. Don't overthink it. After you get results, reflect() on what you learned and decide your next move.`;

  try {
    // Create the ToolLoopAgent - it handles the entire loop automatically
    const agent = new ToolLoopAgent({
      model: anthropic('claude-sonnet-4-20250514'),
      instructions,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal, // Pass abort signal to allow cancellation
      onStepFinish: async ({ text, toolCalls, toolResults, usage }) => {
        // Check if we should stop (database status check)
        const [sessionCheck] = await db
          .select({ status: chatSessions.status })
          .from(chatSessions)
          .where(eq(chatSessions.id, chatSessionId));

        if (sessionCheck?.status !== 'researching') {
          // User stopped research - abort gracefully
          throw new Error('Research stopped by user');
        }
        // Calculate and deduct credits
        const stepCredits = Math.ceil((usage?.totalTokens || 0) / 1000);
        totalCreditsUsed += stepCredits;
        await deductCredits(userId, stepCredits);

        // Emit agent thinking (but don't duplicate in brain - reflection tool handles that)
        if (text) {
          onProgress?.({
            type: 'agent_thinking',
            thinking: text
          });
        }

        // Process tool calls for progress updates
        if (toolCalls) {
          for (const toolCall of toolCalls) {
            const toolName = toolCall.toolName;
            // AI SDK v6: tool calls carry `input`
            const input = (toolCall as any).input;

            console.log(`Tool called: ${toolName}`, input);

            // Emit search query
            if (toolName === 'search') {
              onProgress?.({
                type: 'research_query',
                query: input?.query || 'Searching...'
              });
            }
          }
        }

        // Process tool results for search results display
        if (toolResults) {
          for (const result of toolResults) {
            const toolName = result.toolName;
            // AI SDK v6: tool results carry `output`
            const toolResult = (result as any).output;

            // Emit search results (Tavily format)
            if (toolName === 'search') {
              let resultMessage = '';

              // Tavily returns: { query, answer, results[], timestamp }
              if (toolResult?.answer) {
                resultMessage = `📄 **Search Result:**\n\n${toolResult.answer}\n\n`;
              }

              // Show top results with scores
              if (toolResult?.results && toolResult.results.length > 0) {
                resultMessage += `**📚 Top Sources:**\n`;
                toolResult.results.slice(0, 5).forEach((source: any, idx: number) => {
                  const score = source.score ? ` (relevance: ${(source.score * 100).toFixed(0)}%)` : '';
                  resultMessage += `${idx + 1}. [${source.title}](${source.url})${score}\n`;
                  if (source.content) {
                    // Show snippet
                    const snippet = source.content.substring(0, 150) + '...';
                    resultMessage += `   > ${snippet}\n`;
                  }
                });
              }

              onProgress?.({
                type: 'search_result',
                query: (result as any).input?.query,
                answer: toolResult?.answer || '',
                sources: toolResult?.results || []
              });
            }
          }
        }
      }
    });

    // Execute the agent
    const result = await agent.generate({
      prompt: `Research this: "${researchObjective}"\n\nStart by calling the search tool with your first query.`
    });

    return {
      completed: result.finishReason === 'tool-calls' || result.finishReason === 'stop',
      iterations: result.steps?.length || 0,
      creditsUsed: totalCreditsUsed
    };

  } catch (error) {
    console.error('Research execution error:', error);
    throw error;
  }
}
