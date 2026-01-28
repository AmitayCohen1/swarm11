/**
 * Observatory API - Agent Management
 *
 * POST /api/admin/observatory/agents - Create a new agent (returns auto-generated ID)
 * DELETE /api/admin/observatory/agents?id=xxx - Delete an agent
 * PATCH /api/admin/observatory/agents - Update agent metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAgent, deleteAgent, updateAgentMetrics, addAgentMetric, getAgent, updateAgentEvalBatchSize } from '@/lib/eval';
import { db } from '@/lib/db';
import { llmCalls, llmEvaluations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, model, evalBatchSize } = body;

    if (!name || !description) {
      return NextResponse.json(
        { error: 'name and description are required' },
        { status: 400 }
      );
    }

    // Auto-generate the ID
    const id = await createAgent({ name, description, model, evalBatchSize });

    return NextResponse.json({
      success: true,
      agent: { id, name, description, model, metrics: [] },
      usage: `trackLlmCall({ agentId: '${id}', ... })`,
    });
  } catch (error) {
    console.error('[Observatory Agents] Error:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Delete agent record (if exists)
    await deleteAgent(id);

    // Also clean up orphaned calls and evaluations for this agentId
    await db.delete(llmCalls).where(eq(llmCalls.agentName, id));
    await db.delete(llmEvaluations).where(eq(llmEvaluations.agentName, id));

    return NextResponse.json({ success: true, message: `Agent ${id} deleted` });
  } catch (error) {
    console.error('[Observatory Agents] Error:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, metrics, addMetric, resetData, evalBatchSize } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Check agent exists
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (resetData) {
      // Full reset: delete calls, evaluations, AND metrics
      await db.delete(llmCalls).where(eq(llmCalls.agentName, id));
      await db.delete(llmEvaluations).where(eq(llmEvaluations.agentName, id));
      await updateAgentMetrics(id, []); // Clear all metrics
      return NextResponse.json({ success: true, message: `Agent ${id} fully reset` });
    }

    if (addMetric) {
      // Add a single metric
      await addAgentMetric(id, addMetric);
    } else if (metrics) {
      // Replace all metrics
      await updateAgentMetrics(id, metrics);
    } else if (typeof evalBatchSize === 'number') {
      // Update evaluation trigger threshold for this agent
      await updateAgentEvalBatchSize(id, Math.max(1, Math.floor(evalBatchSize)));
    }

    const updated = await getAgent(id);

    return NextResponse.json({ success: true, agent: updated });
  } catch (error) {
    console.error('[Observatory Agents] Error:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}
