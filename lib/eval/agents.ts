/**
 * Agent Registry
 *
 * Agents are stored in DB with:
 * - Auto-generated ID (key)
 * - Name + description
 * - Metrics (discovered by LLM, editable by user)
 */

import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export interface Metric {
  name: string;
  description: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  metrics?: Metric[];
}

/**
 * Create a new agent in the database. Returns the auto-generated agent ID.
 */
export async function createAgent(config: AgentConfig): Promise<string> {
  const id = nanoid(12); // e.g., "V1StGXR8_Z5j"

  await db.insert(agents).values({
    id,
    name: config.name,
    description: config.description,
    model: config.model,
    criteria: config.metrics || [],
  });

  return id;
}

/**
 * Update an agent's metrics.
 */
export async function updateAgentMetrics(id: string, metrics: Metric[]): Promise<void> {
  await db.update(agents)
    .set({ criteria: metrics })
    .where(eq(agents.id, id));
}

/**
 * Add a metric to an agent.
 */
export async function addAgentMetric(id: string, metric: Metric): Promise<void> {
  const agent = await getAgent(id);
  if (!agent) return;

  const metrics = [...(agent.metrics || []), metric];
  await updateAgentMetrics(id, metrics);
}

/**
 * Delete an agent from the database.
 */
export async function deleteAgent(id: string): Promise<void> {
  await db.delete(agents).where(eq(agents.id, id));
}

/**
 * Get agent config by ID.
 */
export async function getAgent(id: string): Promise<(AgentConfig & { id: string }) | undefined> {
  const [dbAgent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!dbAgent) return undefined;

  return {
    id: dbAgent.id,
    name: dbAgent.name,
    description: dbAgent.description,
    model: dbAgent.model || undefined,
    metrics: (dbAgent.criteria as Metric[]) || [],
  };
}

/**
 * Get all registered agents.
 */
export async function getAllAgents(): Promise<Array<AgentConfig & { id: string }>> {
  const dbAgents = await db.select().from(agents);
  return dbAgents.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    model: a.model || undefined,
    metrics: (a.criteria as Metric[]) || [],
  }));
}
