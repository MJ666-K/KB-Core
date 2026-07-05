import { db } from '../db/client';
import { sql } from 'drizzle-orm';
import { resolveDatasetIds } from './dense';

export interface SparseHit {
  chunkId: string;
  score: number;
}

export async function sparseSearch(
  query: string,
  datasetId: string,
  limit: number,
  datasetIds?: readonly string[],
): Promise<SparseHit[]> {
  const ids = resolveDatasetIds(datasetId, datasetIds);
  if (ids.length === 0) return [];

  const datasetArrayLit = `ARRAY[${ids.map(id => `'${id}'::uuid`).join(',')}]`;

  const result = await db.execute<{
    id: string;
    score: number;
  }>(sql`
    SELECT id::text, ts_rank_cd(tsv, plainto_tsquery('simple', ${query})) AS score
    FROM chunks
    WHERE dataset_id = ANY(${sql.raw(datasetArrayLit)})
      AND tsv @@ plainto_tsquery('simple', ${query})
      AND embedding_status = 'done'
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return result.rows
    .map(r => ({ chunkId: r.id, score: Number(r.score) }))
    .filter(r => r.score > 0);
}
