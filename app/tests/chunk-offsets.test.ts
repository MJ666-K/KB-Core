import { describe, it, expect } from 'bun:test';
import { computeChunkOffsets } from '@features/kb/splitter/offsets';

describe('computeChunkOffsets', () => {
  it('无 overlap 时顺序对齐', () => {
    const source = '第一段。第二段。第三段。';
    const parts = ['第一段。', '第二段。', '第三段。'];
    const offsets = computeChunkOffsets(source, parts);
    expect(offsets).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
    ]);
  });

  it('overlap 子块偏移不重复指向首段', () => {
    const source = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const parts = ['ABCDEFGHIJ', 'GHIJKLMNOP', 'MNOPQRSTUV'];
    const offsets = computeChunkOffsets(source, parts);
    expect(offsets[0]).toEqual({ start: 0, end: 10 });
    expect(offsets[1]!.start).toBe(6);
    expect(offsets[2]!.start).toBeGreaterThan(offsets[1]!.start);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      expect(source.slice(offsets[i]!.start, offsets[i]!.end)).toBe(part);
    }
  });
});
