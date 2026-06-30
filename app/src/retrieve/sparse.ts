import { db } from '../db/client';
import { sql } from 'drizzle-orm';

export interface SparseHit {
  chunkId: string;
  score: number;
}

export async function sparseSearch(
  query: string,
  datasetId: string,
  limit: number,
): Promise<SparseHit[]> {
  const result = await db.execute<{
    id: string;
    score: number;
  }>(sql`
    SELECT id::text, ts_rank_cd(tsv, plainto_tsquery('simple', ${query})) AS score
    FROM chunks
    WHERE dataset_id = ${datasetId}::uuid
      AND tsv @@ plainto_tsquery('simple', ${query})
      AND embedding_status = 'done'
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return result.rows
    .map(r => ({ chunkId: r.id, score: Number(r.score) }))
    .filter(r => r.score > 0);
}
