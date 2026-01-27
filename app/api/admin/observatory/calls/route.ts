/**
 * Observatory API - View individual LLM calls
 *
 * GET /api/admin/observatory/calls - List recent calls with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { llmCalls } from '@/lib/db/schema';
import { desc, eq, and } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const agentName = req.nextUrl.searchParams.get('agent');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');
  const evaluated = req.nextUrl.searchParams.get('evaluated');

  try {
    const conditions = [];

    if (agentName) {
      conditions.push(eq(llmCalls.agentName, agentName));
    }

    if (evaluated === 'true') {
      conditions.push(eq(llmCalls.evaluated, true));
    } else if (evaluated === 'false') {
      conditions.push(eq(llmCalls.evaluated, false));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const calls = await db
      .select({
        id: llmCalls.id,
        agentName: llmCalls.agentName,
        model: llmCalls.model,
        input: llmCalls.input,
        output: llmCalls.output,
        durationMs: llmCalls.durationMs,
        tokenCount: llmCalls.tokenCount,
        evaluated: llmCalls.evaluated,
        createdAt: llmCalls.createdAt,
      })
      .from(llmCalls)
      .where(whereClause)
      .orderBy(desc(llmCalls.createdAt))
      .limit(Math.min(limit, 100));

    return NextResponse.json({ calls });
  } catch (error) {
    console.error('[Admin Eval Calls] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 });
  }
}
