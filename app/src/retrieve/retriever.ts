import { db } from '../db/client';
import { chunks, documents } from '../db/schema';
import { inArray } from 'drizzle-orm';
import { denseSearch, type DenseHit } from './dense';
import { sparseSearch } from './sparse';
import { rrfFusion } from './rrf';
import { ApiReranker, PassThroughReranker, type RerankCandidate, type Reranker } from './reranker';
import { EmbeddingService } from '../embedding/embedding-service';
import { config } from '../config';
import { TTLCache } from '../cache/ttl-cache';

export interface RetrievalResult {
  chunkId: string;
  text: string;
  score: number;
  documentId: string;
  documentTitle: string;
  parentId: string | null;
}

export interface RetrieveOptions {
  datasetId: string;
  topK?: number;
}

export class HybridRetriever {
  private readonly reranker: Reranker;
  private readonly resultCache = new TTLCache<string, RetrievalResult[]>(
    config.resultCacheTtlMs,
    config.resultCacheMax,
  );

  constructor(
    private readonly embeddingService: EmbeddingService,
    reranker?: Reranker,
  ) {
    this.reranker = reranker ?? new ApiReranker();
  }

  async retrieve(query: string, opts: RetrieveOptions): Promise<RetrievalResult[]> {
    const topK = opts.topK ?? config.searchTopK;
    const cacheKey = `${opts.datasetId}:${query}:${topK}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) return cached;

    const queryVec = await this.embeddingService.embedQuery(query);
    const extend = topK * config.denseTopKMultiplier;

    const [denseHits, sparseHits] = await Promise.all([
      denseSearch(queryVec, opts.datasetId, extend),
      sparseSearch(query, opts.datasetId, extend),
    ]);

    const fused = rrfFusion(
      denseHits.map(h => [h.chunkId, h.score] as const),
      sparseHits.map(h => [h.chunkId, h.score] as const),
      config.rrfK,
    );

    if (fused.length === 0) return [];

    const candidateIds = fused.slice(0, config.rerankTopK).map(f => f[0]);
    const candidates = await this.loadCandidates(candidateIds, denseHits);
    const reranked = await this.reranker.rank(query, candidates, topK);

    const seen = new Set<string>();
    const results: RetrievalResult[] = [];
    for (const r of reranked) {
      const key = r.parentId ?? r.chunkId;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        chunkId: r.parentId ?? r.chunkId,
        text: r.text,
        score: r.score,
        documentId: r.documentId,
        documentTitle: '',
        parentId: r.parentId,
      });
      if (results.length >= topK) break;
    }

    await this.fillTitles(results);
    this.resultCache.set(cacheKey, results);
    return results;
  }

  private async loadCandidates(ids: string[], denseHits: DenseHit[]): Promise<RerankCandidate[]> {
    const hitMap = new Map(denseHits.map(h => [h.chunkId, h]));

    const childRows = await db.select({
      id: chunks.id,
      content: chunks.content,
      parentId: chunks.parentId,
      documentId: chunks.documentId,
    }).from(chunks).where(inArray(chunks.id, ids));

    const parentIds = [...new Set(
      childRows.map(r => r.parentId).filter((p): p is string => p !== null),
    )];

    let parentTextMap = new Map<string, string>();
    if (parentIds.length > 0) {
      const parentRows = await db.select({
        id: chunks.id,
        content: chunks.content,
      }).from(chunks).where(inArray(chunks.id, parentIds));
      parentTextMap = new Map(parentRows.map(r => [r.id, r.content]));
    }

    return childRows.map(r => ({
      chunkId: r.id,
      parentId: r.parentId,
      documentId: r.documentId,
      text: (r.parentId && parentTextMap.get(r.parentId)) || r.content,
      score: hitMap.get(r.id)?.score ?? 0,
    }));
  }

  private async fillTitles(results: RetrievalResult[]): Promise<void> {
    const docIds = [...new Set(results.map(r => r.documentId))];
    if (docIds.length === 0) return;

    const docs = await db.select({
      id: documents.id,
      title: documents.title,
    }).from(documents).where(inArray(documents.id, docIds));

    const titleMap = new Map(docs.map(d => [d.id, d.title]));
    for (const r of results) {
      r.documentTitle = titleMap.get(r.documentId) ?? '';
    }
  }
}
