import { db } from '../db/client';
import { chunks } from '../db/schema';
import { cosineDistance, sql, desc, gt, and, eq, isNotNull, inArray } from 'drizzle-orm';

export interface DenseHit {
  chunkId: string;
  content: string;
  parentId: string | null;
  documentId: string;
  score: number;
}

export function resolveDatasetIds(datasetId?: string, datasetIds?: readonly string[]): string[] {
  if (datasetIds && datasetIds.length > 0) return [...datasetIds];
  if (datasetId) return [datasetId];
  return [];
}

export async function denseSearch(
  queryVec: number[],
  datasetId: string,
  limit: number,
  datasetIds?: readonly string[],
): Promise<DenseHit[]> {
  const ids = resolveDatasetIds(datasetId, datasetIds);
  if (ids.length === 0) return [];

  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryVec)})`;

  const datasetFilter = ids.length === 1
    ? eq(chunks.datasetId, ids[0]!)
    : inArray(chunks.datasetId, ids);

  const rows = await db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      parentId: chunks.parentId,
      documentId: chunks.documentId,
      score: similarity,
    })
    .from(chunks)
    .where(and(
      datasetFilter,
      eq(chunks.embeddingStatus, 'done'),
      isNotNull(chunks.embedding),
      gt(similarity, 0.2),
    ))
    .orderBy(desc(similarity))
    .limit(limit);

  return rows.map(r => ({
    chunkId: r.chunkId,
    content: r.content,
    parentId: r.parentId,
    documentId: r.documentId,
    score: Number(r.score),
  }));
}
