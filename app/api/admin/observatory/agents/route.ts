/**
 * Observatory API - Agent Management
 *
 * POST /api/admin/observatory/agents - Create a new agent (returns auto-generated ID)
 * DELETE /api/admin/observatory/agents?id=xxx - Delete an agent
 * PATCH /api/admin/observatory/agents - Update agent metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAgent, deleteAgent, updateAgentMetrics, addAgentMetric, getAgent } from '@/lib/eval';
import { db } from '@/lib/db';
import { llmCalls, llmEvaluations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, model } = body;

    if (!name || !description) {
      return NextResponse.json(
        { error: 'name and description are required' },
        { status: 400 }
      );
    }

    // Auto-generate the ID
    const id = await createAgent({ name, description, model });

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
    const { id, metrics, addMetric, resetData } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Check agent exists
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (resetData) {
      // Delete calls first (they reference evaluations via evaluation_batch_id)
      await db.delete(llmCalls).where(eq(llmCalls.agentName, id));
      await db.delete(llmEvaluations).where(eq(llmEvaluations.agentName, id));
      return NextResponse.json({ success: true, message: `Data reset for agent ${id}` });
    }

    if (addMetric) {
      // Add a single metric
      await addAgentMetric(id, addMetric);
    } else if (metrics) {
      // Replace all metrics
      await updateAgentMetrics(id, metrics);
    }

    const updated = await getAgent(id);

    return NextResponse.json({ success: true, agent: updated });
  } catch (error) {
    console.error('[Observatory Agents] Error:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}
