import { db } from '@/lib/db';
import { searchQueries, researchSessions, chatSessions } from '@/lib/db/schema';
import { eq, desc, sql, and, ilike } from 'drizzle-orm';

/**
 * Find similar queries that have been run before (across all sessions)
 * Returns queries that contain the same key terms
 */
export async function findSimilarQueries(
  query: string,
  limit: number = 5
): Promise<{ query: string; answer: string | null; wasUseful: boolean | null }[]> {
  const normalized = query.toLowerCase().trim();

  // Search for queries containing similar terms
  const results = await db
    .select({
      query: searchQueries.query,
      answer: searchQueries.answer,
      wasUseful: searchQueries.wasUseful
    })
    .from(searchQueries)
    .where(ilike(searchQueries.queryNormalized, `%${normalized}%`))
    .orderBy(desc(searchQueries.createdAt))
    .limit(limit);

  return results;
}

/**
 * Check if an exact query has been run before
 */
export async function hasQueryBeenRunGlobally(query: string): Promise<boolean> {
  const normalized = query.toLowerCase().trim();

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(searchQueries)
    .where(eq(searchQueries.queryNormalized, normalized));

  return (result?.count || 0) > 0;
}

/**
 * Get the most frequently run queries (for analytics)
 */
export async function getMostFrequentQueries(
  limit: number = 20
): Promise<{ query: string; count: number }[]> {
  const results = await db
    .select({
      query: searchQueries.queryNormalized,
      count: sql<number>`count(*)`.as('count')
    })
    .from(searchQueries)
    .groupBy(searchQueries.queryNormalized)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return results.map(r => ({ query: r.query, count: Number(r.count) }));
}

/**
 * Get research session history for a user
 */
export async function getUserResearchHistory(
  userId: string,
  limit: number = 10
): Promise<{
  id: string;
  objective: string;
  status: string;
  confidenceLevel: string | null;
  totalSteps: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}[]> {
  const results = await db
    .select({
      id: researchSessions.id,
      objective: researchSessions.objective,
      status: researchSessions.status,
      confidenceLevel: researchSessions.confidenceLevel,
      totalSteps: researchSessions.totalSteps,
      startedAt: researchSessions.startedAt,
      completedAt: researchSessions.completedAt
    })
    .from(researchSessions)
    .innerJoin(chatSessions, eq(researchSessions.chatSessionId, chatSessions.id))
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(researchSessions.startedAt))
    .limit(limit);

  return results;
}

/**
 * Get all queries from a specific research session
 */
export async function getResearchSessionQueries(
  researchSessionId: string
): Promise<{
  query: string;
  purpose: string | null;
  answer: string | null;
  sources: any;
  cycleNumber: number | null;
  wasUseful: boolean | null;
}[]> {
  const results = await db
    .select({
      query: searchQueries.query,
      purpose: searchQueries.purpose,
      answer: searchQueries.answer,
      sources: searchQueries.sources,
      cycleNumber: searchQueries.cycleNumber,
      wasUseful: searchQueries.wasUseful
    })
    .from(searchQueries)
    .where(eq(searchQueries.researchSessionId, researchSessionId))
    .orderBy(searchQueries.createdAt);

  return results;
}

/**
 * Mark a query as useful or not useful (for learning)
 */
export async function markQueryUsefulness(
  queryId: string,
  wasUseful: boolean
): Promise<void> {
  await db
    .update(searchQueries)
    .set({ wasUseful })
    .where(eq(searchQueries.id, queryId));
}

/**
 * Get aggregate stats for research sessions
 */
export async function getResearchStats(userId?: string): Promise<{
  totalSessions: number;
  completedSessions: number;
  totalQueries: number;
  avgQueriesPerSession: number;
  avgStepsPerSession: number;
}> {
  // Build the base query
  let sessionsQuery = db
    .select({
      count: sql<number>`count(*)`,
      completed: sql<number>`sum(case when ${researchSessions.status} = 'completed' then 1 else 0 end)`,
      avgSteps: sql<number>`avg(${researchSessions.totalSteps})`
    })
    .from(researchSessions);

  if (userId) {
    sessionsQuery = sessionsQuery
      .innerJoin(chatSessions, eq(researchSessions.chatSessionId, chatSessions.id))
      .where(eq(chatSessions.userId, userId)) as any;
  }

  const [sessionStats] = await sessionsQuery;

  const [queryStats] = await db
    .select({
      count: sql<number>`count(*)`
    })
    .from(searchQueries);

  const totalSessions = Number(sessionStats?.count || 0);
  const totalQueries = Number(queryStats?.count || 0);

  return {
    totalSessions,
    completedSessions: Number(sessionStats?.completed || 0),
    totalQueries,
    avgQueriesPerSession: totalSessions > 0 ? totalQueries / totalSessions : 0,
    avgStepsPerSession: Number(sessionStats?.avgSteps || 0)
  };
}
