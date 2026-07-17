import { describe, it, expect } from 'bun:test';
import { applyRerankFilter, buildRerankFilterLog, formatRerankFilterDocs } from '@features/kb/retrieve/filter';
import type { RerankCandidate } from '@features/kb/retrieve/reranker';

const mk = (id: string, score: number): RerankCandidate => ({
  chunkId: id,
  parentId: null,
  documentId: 'doc-1',
  text: `content ${id}`,
  score,
});

describe('applyRerankFilter', () => {
  it('Rerank 成功时只按 rerankMin 过滤，不看 dense', () => {
    const ranked = [mk('a', 0.82), mk('b', 0.48), mk('c', 0.75)];
    const { kept } = applyRerankFilter(ranked, 0.5, false);
    expect(kept.map(r => r.chunkId)).toEqual(['a', 'c']);
  });

  it('过滤后为空则返回空数组，不降级', () => {
    const ranked = [mk('a', 0.48), mk('b', 0.46), mk('c', 0.44)];
    const { kept } = applyRerankFilter(ranked, 0.5, false);
    expect(kept).toEqual([]);
  });

  it('Rerank fallback 时不做分数过滤', () => {
    const ranked = [mk('a', 0.1), mk('b', 0.2)];
    const { kept } = applyRerankFilter(ranked, 0.5, true);
    expect(kept).toEqual(ranked);
  });
});

describe('buildRerankFilterLog', () => {
  it('输出每条 doc 的 dense/rerank 分数', () => {
    const ranked = [mk('aaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 0.82), mk('b', 0.48)];
    const denseMap = new Map([['aaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 0.66]]);
    const { kept } = applyRerankFilter(ranked, 0.5, false);
    const log = buildRerankFilterLog(ranked, denseMap, 0.5, false, kept);
    expect(log.before).toBe(2);
    expect(log.after).toBe(1);
    expect(log.docs[0]!.passed).toBe(true);
    expect(log.docs[1]!.passed).toBe(false);
    expect(formatRerankFilterDocs(log.docs)).toContain('dense=0.66');
    expect(formatRerankFilterDocs(log.docs)).toContain('dense=--');
  });
});
