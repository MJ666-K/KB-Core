import { db } from '@core/db/client';
import { sql } from 'drizzle-orm';
import { resolveDatasetIds } from './dense';
import { extractSearchTerms } from './sparse-terms';
import { logger } from '@core/utils/logger';

export interface SparseHit {
  chunkId: string;
  score: number;
}

let tsvColumnChecked = false;
let tsvColumnExists = false;

/** 启动后首次检索时探测 tsv 列是否存在 */
async function checkTsvColumn(): Promise<boolean> {
  if (tsvColumnChecked) return tsvColumnExists;
  tsvColumnChecked = true;
  try {
    const res = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'chunks' AND column_name = 'tsv'
      ) AS exists
    `);
    tsvColumnExists = Boolean(res.rows[0]?.exists);
    if (!tsvColumnExists) {
      logger.warn('[Sparse] chunks.tsv 列不存在，请执行 bun run db:migrate');
    }
  } catch (err) {
    logger.warn('[Sparse] 无法检测 tsv 列', err);
    tsvColumnExists = false;
  }
  return tsvColumnExists;
}

/** 中文关键词 ILIKE 匹配（simple tsvector 无法索引纯中文） */
async function ilikeSparseSearch(
  terms: string[],
  datasetArrayLit: string,
  limit: number,
): Promise<SparseHit[]> {
  if (terms.length === 0) return [];

  const result = await db.execute<{ id: string; score: number }>(sql`
    WITH terms AS (
      SELECT unnest(ARRAY[${sql.join(terms.map(t => sql`${t}`), sql`, `)}]::text[]) AS term
    )
    SELECT c.id::text,
      (SELECT count(*)::float FROM terms t WHERE c.content LIKE '%' || t.term || '%') AS score
    FROM chunks c
    WHERE c.dataset_id = ANY(${sql.raw(datasetArrayLit)})
      AND c.embedding_status = 'done'
      AND EXISTS (
        SELECT 1 FROM terms t WHERE c.content LIKE '%' || t.term || '%'
      )
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return result.rows
    .map(r => ({ chunkId: r.id, score: Number(r.score) }))
    .filter(r => r.score > 0);
}

/** 英文/混合文本 tsvector 检索（tsv 列存在时） */
async function tsvectorSparseSearch(
  query: string,
  datasetArrayLit: string,
  limit: number,
): Promise<SparseHit[]> {
  const result = await db.execute<{ id: string; score: number }>(sql`
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

function mergeSparseHits(a: SparseHit[], b: SparseHit[]): SparseHit[] {
  const map = new Map<string, number>();
  for (const h of [...a, ...b]) {
    map.set(h.chunkId, Math.max(map.get(h.chunkId) ?? 0, h.score));
  }
  return [...map.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((x, y) => y.score - x.score);
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
  const terms = extractSearchTerms(query);

  const hasTsv = await checkTsvColumn();

  const [ilikeHits, tsHits] = await Promise.all([
    ilikeSparseSearch(terms, datasetArrayLit, limit),
    hasTsv && /[a-zA-Z]/.test(query)
      ? tsvectorSparseSearch(query, datasetArrayLit, limit)
      : Promise.resolve([] as SparseHit[]),
  ]);

  const merged = mergeSparseHits(ilikeHits, tsHits);

  logger.debug('[Sparse] 检索明细', {
    terms: terms.slice(0, 8),
    termCount: terms.length,
    ilikeHits: ilikeHits.length,
    tsvectorHits: tsHits.length,
    merged: merged.length,
    hasTsv,
  });

  return merged.slice(0, limit);
}

export { extractSearchTerms };
