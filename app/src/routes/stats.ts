import { Hono } from 'hono';
import { db } from '../db/client';
import { documents, chunks, datasets, queryLogs } from '../db/schema';
import { sql, eq, and, isNull } from 'drizzle-orm';

const app = new Hono();

app.get('/', async (c) => {
  const totalDocs = await db.select({ c: sql<number>`COUNT(*)` }).from(documents).where(isNull(documents.deletedAt));
  const totalChunks = await db.select({ c: sql<number>`COUNT(*)` }).from(chunks);
  const readyChunks = await db.select({ c: sql<number>`COUNT(*)` }).from(chunks).where(eq(chunks.embeddingStatus, 'done'));
  const totalQueries = await db.select({ c: sql<number>`COUNT(*)` }).from(queryLogs);
  const todayQueries = await db.select({ c: sql<number>`COUNT(*)` }).from(queryLogs)
    .where(sql`${queryLogs.createdAt}::date = CURRENT_DATE`);

  const datasetStats = await db.select({
    name: datasets.name,
    docCount: sql<number>`COUNT(DISTINCT ${documents.id})::int`,
    chunkCount: sql<number>`COUNT(${chunks.id})::int`,
  }).from(datasets)
    .leftJoin(documents, and(eq(documents.datasetId, datasets.id), isNull(documents.deletedAt)))
    .leftJoin(chunks, and(eq(chunks.documentId, documents.id), eq(chunks.datasetId, datasets.id)))
    .groupBy(datasets.id, datasets.name);

  return c.json({
    totalDocuments: Number(totalDocs[0]?.c ?? 0),
    totalChunks: Number(totalChunks[0]?.c ?? 0),
    readyChunks: Number(readyChunks[0]?.c ?? 0),
    totalQueries: Number(totalQueries[0]?.c ?? 0),
    todayQueries: Number(todayQueries[0]?.c ?? 0),
    datasetStats,
  });
});

export default app;
