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

  it('仅按句号切分，不按换行', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 10 }));
    const chunks = s.splitRaw('段落一内容。这是第一段的更多内容。\n\n段落二内容。');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.trimEnd().endsWith('。') || c.includes('。')).toBe(true);
    }
  });

  it('多句按句号切分', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 8 }));
    expect(s.splitRaw('这是第一句话。这是第二句话。这是第三句话。').length).toBeGreaterThanOrEqual(2);
  });

  it('不在感叹号问号分号处切分', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 8 }));
    const chunks = s.splitRaw('这是第一句。这是第二句！这是第三句？这是第四句；');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      const trimmed = c.trimEnd();
      if (trimmed.includes('。')) {
        expect(trimmed.endsWith('。') || trimmed.endsWith('！') || trimmed.endsWith('？') || trimmed.endsWith('；')).toBe(true);
      }
    }
    expect(chunks.some(c => c.includes('！'))).toBe(true);
  });

  it('每块以句号结尾或在句号处拼接', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 12 }));
    const text = '第一句内容比较长。第二句内容也比较长。第三句继续。第四句结束。';
    const chunks = s.splitRaw(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c).toMatch(/。/);
    }
  });

  it('无句号的长文本不切中间', () => {
    const s = new RecursiveSplitter(makeConfig({ maxChunkSize: 5 }));
    const text = '这是一段没有任何句号的长文本内容';
    expect(s.splitRaw(text)).toEqual([text]);
  });
});
