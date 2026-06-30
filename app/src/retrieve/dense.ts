import { db } from '../db/client';
import { chunks } from '../db/schema';
import { cosineDistance, sql, desc, gt, and, eq, isNotNull } from 'drizzle-orm';

export interface DenseHit {
  chunkId: string;
  content: string;
  parentId: string | null;
  documentId: string;
  score: number;
}

export async function denseSearch(
  queryVec: number[],
  datasetId: string,
  limit: number,
): Promise<DenseHit[]> {
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, queryVec)})`;

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
      eq(chunks.datasetId, datasetId),
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
