import type { RerankCandidate } from './reranker';

export interface RerankFilterResult {
  kept: RerankCandidate[];
}

export interface RerankFilterDocLog {
  rank: number;
  chunkId: string;
  dense: number | undefined;
  rerank: number;
  passed: boolean;
}

/**
 * 最终过滤只认 Rerank 分数；Dense 不参与裁决。
 * Rerank API 不可用时按 RRF 原序返回，不做分数过滤。
 * 过滤为空则返回空数组，由 LLM 在无检索结果时自行分析。
 */
export function applyRerankFilter(
  reranked: RerankCandidate[],
  rerankMinScore: number,
  rerankFallback: boolean,
): RerankFilterResult {
  if (reranked.length === 0) {
    return { kept: [] };
  }

  if (rerankFallback) {
    return { kept: reranked };
  }

  return { kept: reranked.filter(r => r.score >= rerankMinScore) };
}

export function buildRerankFilterLog(
  reranked: RerankCandidate[],
  denseMap: Map<string, number>,
  rerankMinScore: number,
  rerankFallback: boolean,
  kept: RerankCandidate[],
): {
  before: number;
  after: number;
  rerankMin: number;
  rerankFallback: boolean;
  docs: RerankFilterDocLog[];
} {
  const keptIds = new Set(kept.map(r => r.chunkId));
  const docs = reranked.map((r, i) => ({
    rank: i + 1,
    chunkId: r.chunkId.slice(0, 8),
    dense: denseMap.get(r.chunkId),
    rerank: r.score,
    passed: rerankFallback ? keptIds.has(r.chunkId) : r.score >= rerankMinScore,
  }));

  return {
    before: reranked.length,
    after: kept.length,
    rerankMin: rerankMinScore,
    rerankFallback,
    docs,
  };
}

export function formatRerankFilterDocs(docs: RerankFilterDocLog[]): string {
  return docs.map(d => {
    const denseStr = d.dense !== undefined ? d.dense.toFixed(2) : '--';
    const flag = d.passed ? '✓' : '✗';
    return `Doc${d.rank} ${d.chunkId} dense=${denseStr} rerank=${d.rerank.toFixed(2)} ${flag}`;
  }).join(' | ');
}
