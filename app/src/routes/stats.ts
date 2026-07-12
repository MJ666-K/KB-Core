import { Hono } from 'hono';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission } from '../auth/middleware';
import { db } from '../db/client';
import {
  documents, chunks, datasets, queryLogs,
  agents, models, skillDefinitions, users, chatSessions,
} from '../db/schema';
import { sql, eq, and, isNull } from 'drizzle-orm';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('dashboard:view'));

app.get('/', async (c) => {
  const [
    totalDocs,
    totalChunks,
    readyChunks,
    totalQueries,
    todayQueries,
    agentCount,
    modelCount,
    skillCount,
    userCount,
    sessionCount,
    datasetStats,
  ] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)::int` }).from(documents).where(isNull(documents.deletedAt)),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(chunks),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(chunks).where(eq(chunks.embeddingStatus, 'done')),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(queryLogs),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(queryLogs)
      .where(sql`${queryLogs.createdAt}::date = CURRENT_DATE`),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(agents),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(models),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(skillDefinitions),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(users).where(isNull(users.disabled)),
    db.select({ c: sql<number>`COUNT(*)::int` }).from(chatSessions),
    db.select({
      name: datasets.name,
      docCount: sql<number>`COUNT(DISTINCT ${documents.id})::int`,
      chunkCount: sql<number>`COUNT(${chunks.id})::int`,
    }).from(datasets)
      .leftJoin(documents, and(eq(documents.datasetId, datasets.id), isNull(documents.deletedAt)))
      .leftJoin(chunks, and(eq(chunks.documentId, documents.id), eq(chunks.datasetId, datasets.id)))
      .groupBy(datasets.id, datasets.name),
  ]);

  return c.json({
    documentCount: totalDocs[0]?.c ?? 0,
    chunkCount: totalChunks[0]?.c ?? 0,
    embeddingCount: readyChunks[0]?.c ?? 0,
    queryCount: totalQueries[0]?.c ?? 0,
    todayQueryCount: todayQueries[0]?.c ?? 0,
    agentCount: agentCount[0]?.c ?? 0,
    modelCount: modelCount[0]?.c ?? 0,
    skillCount: skillCount[0]?.c ?? 0,
    userCount: userCount[0]?.c ?? 0,
    sessionCount: sessionCount[0]?.c ?? 0,
    datasetStats,
  });
});

export default app;
