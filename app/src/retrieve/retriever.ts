import { db } from '../db/client';
import { chunks, documents } from '../db/schema';
import { inArray } from 'drizzle-orm';
import { denseSearch, type DenseHit } from './dense';
import { sparseSearch } from './sparse';
import { rrfFusion } from './rrf';
import { ApiReranker, type RerankCandidate, type Reranker } from './reranker';
import { applyRerankFilter, buildRerankFilterLog, formatRerankFilterDocs } from './filter';
import { EmbeddingService } from '../embedding/embedding-service';
import { config } from '../config';
import { getQuerySettings } from '../settings/effective-config';
import { TTLCache } from '../cache/ttl-cache';
import { logger } from '../utils/logger';

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
  datasetIds?: readonly string[];
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
    const q = getQuerySettings();
    const topK = opts.topK ?? q.searchTopK;
    const idsStr = (opts.datasetIds ?? [opts.datasetId]).join(',');
    const cacheKey = `${idsStr}:${query}:${topK}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) return cached;
    return (await this.retrieveWithDetails(query, opts)).results;
  }

  async retrieveWithDetails(query: string, opts: RetrieveOptions): Promise<RetrieveWithDetailsResult> {
    const q = getQuerySettings();
    const topK = opts.topK ?? q.searchTopK;
    const idsStr = (opts.datasetIds ?? [opts.datasetId]).join(',');

    const queryVec = await this.embeddingService.embedQuery(query);
    const extend = topK * q.denseTopKMultiplier;

    logger.info('[检索] 召回配置', {
      query: query.slice(0, 80),
      topK,
      extend,
      denseRecallMin: q.denseMinSimilarity,
      rerankMinScore: q.rerankMinScore,
      denseTopKMultiplier: q.denseTopKMultiplier,
      rrfK: q.rrfK,
      rerankTopK: q.rerankTopK,
      note: 'denseMin 仅用于召回，最终过滤只看 rerankMin',
    });

    const [denseHits, sparseHits] = await Promise.all([
      denseSearch(queryVec, opts.datasetId, extend, opts.datasetIds),
      sparseSearch(query, opts.datasetId, extend, opts.datasetIds),
    ]);

    const denseMap = new Map(denseHits.map(h => [h.chunkId, h.score]));
    const sparseMap = new Map(sparseHits.map(h => [h.chunkId, h.score]));

    const denseIds = new Set(denseHits.map(h => h.chunkId));
    const sparseIds = new Set(sparseHits.map(h => h.chunkId));
    let overlap = 0;
    for (const id of denseIds) {
      if (sparseIds.has(id)) overlap++;
    }

    logger.info('[检索] 召回结果', {
      dense: denseHits.length,
      sparse: sparseHits.length,
      overlap,
      denseOnly: denseHits.length - overlap,
      sparseOnly: sparseHits.length - overlap,
      denseTop: denseHits.slice(0, 3).map(h => `${h.chunkId.slice(0, 8)}=${h.score.toFixed(3)}`).join(', ') || '(none)',
      sparseTop: sparseHits.slice(0, 3).map(h => `${h.chunkId.slice(0, 8)}=${h.score.toFixed(2)}`).join(', ') || '(none)',
    });

    const fused = rrfFusion(
      denseHits.map(h => [h.chunkId, h.score] as const),
      sparseHits.map(h => [h.chunkId, h.score] as const),
      q.rrfK,
    );
    const rrfMap = new Map(fused.map(f => [f[0], f[1]]));

    logger.info('[检索] RRF 融合', {
      rrf: fused.length,
      rrfTop: fused.slice(0, 5).map(([id, s]) => `${id.slice(0, 8)}=${s.toFixed(4)}`).join(', ') || '(none)',
    });

    if (fused.length === 0) {
      const empty: RetrievalResult[] = [];
      const cacheKey = `${idsStr}:${query}:${topK}`;
      this.resultCache.set(cacheKey, empty);
      return { results: empty, details: { query, topK, denseCount: 0, sparseCount: 0, rrfCount: 0, rerankCount: 0, rerankFallback: false, candidates: [] } };
    }

    const candidateIds = fused.slice(0, q.rerankTopK).map(f => f[0]);
    const candidates = await this.loadCandidates(candidateIds, denseHits);
    const { results: reranked, fallback: rerankFallback } = await this.reranker.rank(
      query, candidates, q.rerankTopK,
    );
    const { kept: scoreFiltered } = applyRerankFilter(reranked, q.rerankMinScore, rerankFallback);
    const filterLog = buildRerankFilterLog(
      reranked, denseMap, q.rerankMinScore, rerankFallback, scoreFiltered,
    );
    logger.info('[检索] Rerank 过滤', {
      ...filterLog,
      detail: formatRerankFilterDocs(filterLog.docs),
    });
    const rerankScoreMap = new Map(reranked.map((r, i) => [r.chunkId, { score: r.score, rank: i + 1 }]));

    const seen = new Set<string>();
    const finalIds = new Set<string>();
    const results: RetrievalResult[] = [];
    for (const r of scoreFiltered) {
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

    const cacheKey = `${idsStr}:${query}:${topK}`;
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
