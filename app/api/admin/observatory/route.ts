/**
 * Observatory API - Agent Performance Dashboard
 *
 * GET /api/admin/observatory - Get all agents + their evaluation stats
 * POST /api/admin/observatory - Trigger evaluation for an agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEvaluationStats, triggerEvaluation, getAllAgents } from '@/lib/eval';
import { db } from '@/lib/db';
import { llmCalls, llmEvaluations } from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const agentFilter = req.nextUrl.searchParams.get('agent');

  try {
    // Get all registered agents
    const agents = await getAllAgents();

    // Get evaluations
    const evaluations = await getEvaluationStats(agentFilter || undefined);

    // Get pending counts per agent
    const pendingCounts = await db
      .select({
        agentId: llmCalls.agentName,
        count: sql<number>`count(*)::int`,
      })
      .from(llmCalls)
      .where(eq(llmCalls.evaluated, false))
      .groupBy(llmCalls.agentName);

    // Get total counts per agent
    const totalCounts = await db
      .select({
        agentId: llmCalls.agentName,
        count: sql<number>`count(*)::int`,
      })
      .from(llmCalls)
      .groupBy(llmCalls.agentName);

    // Get average scores per agent (from last 5 evaluations each)
    const avgScores = await db
      .select({
        agentId: llmEvaluations.agentName,
        scores: llmEvaluations.scores,
      })
      .from(llmEvaluations)
      .orderBy(desc(llmEvaluations.createdAt))
      .limit(50);

    // Aggregate scores by agent
    const scoresByAgent: Record<string, { total: number; count: number; avg: number }> = {};
    for (const row of avgScores) {
      const overall = (row.scores as Record<string, number>)?.overall ?? 0;
      if (!scoresByAgent[row.agentId]) {
        scoresByAgent[row.agentId] = { total: 0, count: 0, avg: 0 };
      }
      scoresByAgent[row.agentId].total += overall;
      scoresByAgent[row.agentId].count += 1;
    }
    for (const agentId of Object.keys(scoresByAgent)) {
      scoresByAgent[agentId].avg = Math.round((scoresByAgent[agentId].total / scoresByAgent[agentId].count) * 10) / 10;
    }

    // Build response with agent info + stats
    const agentStats = agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model: agent.model,
      evalBatchSize: agent.evalBatchSize,
      criteria: agent.metrics,
      stats: {
        totalCalls: totalCounts.find(t => t.agentId === agent.id)?.count ?? 0,
        pendingEval: pendingCounts.find(p => p.agentId === agent.id)?.count ?? 0,
        avgScore: scoresByAgent[agent.id]?.avg ?? null,
      },
    }));

    return NextResponse.json({
      agents: agentStats,
      recentEvaluations: evaluations,
    });
  } catch (error) {
    console.error('[Observatory] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch observatory data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const agentId = body.agentId;

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    await triggerEvaluation(agentId);

    return NextResponse.json({ success: true, message: `Evaluation triggered for ${agentId}` });
  } catch (error) {
    console.error('[Observatory] Error:', error);
    return NextResponse.json({ error: 'Failed to trigger evaluation' }, { status: 500 });
  }
}
