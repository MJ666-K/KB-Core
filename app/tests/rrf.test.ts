import { describe, it, expect } from 'bun:test';
import { rrfFusion } from '../src/retrieve/rrf';

describe('rrfFusion', () => {
  it('两个列表都排前列的文档得分最高', () => {
    const dense: Array<[string, number]> = [['A', 0.95], ['B', 0.87], ['C', 0.82]];
    const sparse: Array<[string, number]> = [['B', 12.3], ['E', 10.1], ['A', 8.5]];
    const fused = rrfFusion(dense, sparse, 60);
    expect(fused[0]![0]).toBe('B');
  });

  it('只在一个列表出现的文档得分低于两个列表都出现的', () => {
    const dense: Array<[string, number]> = [['A', 0.9], ['B', 0.8]];
    const sparse: Array<[string, number]> = [['A', 5.0], ['C', 3.0]];
    const fused = rrfFusion(dense, sparse);
    expect(fused.find(f => f[0] === 'A')![1]).toBeGreaterThan(fused.find(f => f[0] === 'C')![1]);
  });

  it('空列表返回空', () => {
    expect(rrfFusion([], [])).toEqual([]);
  });

  it('尺度无关', () => {
    const fused = rrfFusion([['A', 0.5]], [['A', 99.9]]);
    expect(fused[0]![0]).toBe('A');
    expect(fused[0]![1]).toBeCloseTo(2 / 61, 3);
  });
});
