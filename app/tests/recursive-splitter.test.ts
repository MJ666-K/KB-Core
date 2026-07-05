import { describe, it, expect } from 'bun:test';
import { RecursiveSplitter } from '../src/splitter/recursive-splitter';
import { SEPARATOR_LEVELS } from '../src/splitter/separators';
import { countTokens } from '../src/splitter/token-counter';

const defaultConfig = {
  maxChunkSize: 50, overlapSize: 10, minChunkSize: 15,
  lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
};
const makeConfig = (o: Partial<typeof defaultConfig> = {}) => ({ ...defaultConfig, ...o });

describe('RecursiveSplitter', () => {
  it('短文本不切分', () => {
    const s = new RecursiveSplitter(makeConfig());
    expect(s.splitRaw('这是一个短文本。')).toHaveLength(1);
  });
  it('按段落切分', () => {
    // maxChunkSize=10 强制切分（文本 ~19 token > 10）
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 10 }));
    expect(s.splitRaw('段落一内容。这是第一段的更多内容。\n\n段落二内容。这是第二段的更多内容。').length).toBeGreaterThanOrEqual(2);
  });
  it('长段落递归降级', () => {
    // maxChunkSize=8 强制降级到句子级
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 8 }));
    expect(s.splitRaw('这是第一句话。这是第二句话。这是第三句话。这是第四句话。').length).toBeGreaterThanOrEqual(2);
  });
  it('混合标点按句式切割', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 8 }));
    const chunks = s.splitRaw('这是第一句。这是第二句！这是第三句？这是第四句；');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      const trimmed = c.trimEnd();
      expect(trimmed).toMatch(/[。！？；]$/);
    }
  });
  it('按段落优先于按标点', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 50 }));
    const chunks = s.splitRaw('段落一第一句。段落一第二句。\n\n段落二内容。');
    expect(chunks.some(c => c.includes('段落一'))).toBe(true);
    expect(chunks.some(c => c.includes('段落二'))).toBe(true);
  });
});
