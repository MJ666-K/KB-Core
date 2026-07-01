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

export interface RetrievalCandidateDetail {
  chunkId: string;
  documentId: string;
  content: string;
  scores: {
    dense?: number;
    sparse?: number;
    rrf: number;
    rerank?: number;
  };
  rank: number;
  inFinal: boolean;
}

export interface RetrievalDetails {
  query: string;
  topK: number;
  denseCount: number;
  sparseCount: number;
  rrfCount: number;
  rerankCount: number;
  rerankFallback: boolean;
  candidates: RetrievalCandidateDetail[];
}

export interface RetrieveOptions {
  datasetId: string;
  topK?: number;
}

export interface RetrieveWithDetailsResult {
  results: RetrievalResult[];
  details: RetrievalDetails;
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
    return (await this.retrieveWithDetails(query, opts)).results;
  }

  async retrieveWithDetails(query: string, opts: RetrieveOptions): Promise<RetrieveWithDetailsResult> {
    const topK = opts.topK ?? config.searchTopK;

    const queryVec = await this.embeddingService.embedQuery(query);
    const extend = topK * config.denseTopKMultiplier;

    const [denseHits, sparseHits] = await Promise.all([
      denseSearch(queryVec, opts.datasetId, extend),
      sparseSearch(query, opts.datasetId, extend),
    ]);

    const denseMap = new Map(denseHits.map(h => [h.chunkId, h.score]));
    const sparseMap = new Map(sparseHits.map(h => [h.chunkId, h.score]));

    const fused = rrfFusion(
      denseHits.map(h => [h.chunkId, h.score] as const),
      sparseHits.map(h => [h.chunkId, h.score] as const),
      config.rrfK,
    );
    const rrfMap = new Map(fused.map(f => [f[0], f[1]]));

    if (fused.length === 0) {
      const empty: RetrievalResult[] = [];
      const cacheKey = `${opts.datasetId}:${query}:${topK}`;
      this.resultCache.set(cacheKey, empty);
      return { results: empty, details: { query, topK, denseCount: 0, sparseCount: 0, rrfCount: 0, rerankCount: 0, rerankFallback: false, candidates: [] } };
    }

    const candidateIds = fused.slice(0, config.rerankTopK).map(f => f[0]);
    const candidates = await this.loadCandidates(candidateIds, denseHits);
    const { results: reranked, fallback: rerankFallback } = await this.reranker.rank(query, candidates, topK);
    const rerankScoreMap = new Map(reranked.map((r, i) => [r.chunkId, { score: r.score, rank: i }]));

    const seen = new Set<string>();
    const finalIds = new Set<string>();
    const results: RetrievalResult[] = [];
    for (const r of reranked) {
      const key = r.parentId ?? r.chunkId;
      if (seen.has(key)) continue;
      seen.add(key);
      finalIds.add(r.chunkId);
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

    const candidatesDetail: RetrievalCandidateDetail[] = reranked.map((r, i) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      content: r.text.slice(0, 200),
      scores: {
        dense: denseMap.get(r.chunkId),
        sparse: sparseMap.get(r.chunkId),
        rrf: rrfMap.get(r.chunkId) ?? 0,
        rerank: rerankScoreMap.get(r.chunkId)?.score,
      },
      rank: i + 1,
      inFinal: finalIds.has(r.chunkId),
    }));

    const cacheKey = `${opts.datasetId}:${query}:${topK}`;
    this.resultCache.set(cacheKey, results);

    return {
      results,
      details: {
        query, topK,
        denseCount: denseHits.length,
        sparseCount: sparseHits.length,
        rrfCount: fused.length,
        rerankCount: reranked.length,
        rerankFallback,
        candidates: candidatesDetail,
      },
    };
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
