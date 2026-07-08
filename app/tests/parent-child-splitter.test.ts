import { describe, it, expect } from 'bun:test';
import { ParentChildSplitter } from '../src/splitter/parent-child-splitter';
import { SEPARATOR_LEVELS } from '../src/splitter/separators';
import { countTokens } from '../src/splitter/token-counter';
import { normalizeDocumentContent } from '../src/utils/text-normalize';

const parentConfig = {
  maxChunkSize: 100, overlapSize: 10, minChunkSize: 30,
  lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
};
const childConfig = {
  maxChunkSize: 30, overlapSize: 5, minChunkSize: 10,
  lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
};

describe('ParentChildSplitter', () => {
  it('生成 parent + child 两级', () => {
    const s = new ParentChildSplitter(parentConfig, childConfig);
    const text = '段落一。这是第一段的内容。内容比较多。\n\n段落二。这是第二段。内容也很丰富。\n\n段落三。第三段内容。';
    const units = s.split(text);
    const parents = units.filter(u => u.isParent);
    const children = units.filter(u => !u.isParent);
    expect(parents.length).toBeGreaterThanOrEqual(1);
    expect(children.length).toBeGreaterThanOrEqual(parents.length);
  });

  it('每个 child 有 parentChunkIndex 指向 parent', () => {
    const s = new ParentChildSplitter(parentConfig, childConfig);
    const units = s.split('这是一个较长的文本。包含多个句子。用于测试分块。\n\n第二段开始。也有多个句子。确保切分正常工作。');
    const children = units.filter(u => !u.isParent);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.parentChunkIndex).toBeDefined();
      expect(child.childIndexWithinParent).not.toBeNull();
    }
  });

  it('每个 unit 的 offset 对应规范化后原文片段', () => {
    const s = new ParentChildSplitter(parentConfig, childConfig);
    const text = '段落一。这是第一段的内容。内容比较多。\n\n段落二。这是第二段。内容也很丰富。\n\n段落三。第三段内容。';
    const normalized = normalizeDocumentContent(text);
    const units = s.split(text);
    for (const u of units) {
      // u.text 即原片段 = normalized.slice(start,end)
      const originalSlice = normalized.slice(u.startOffset, u.endOffset);
      expect(u.text).toBe(originalSlice);
      // 同时保证 start/end 真的指向原文物理位置
      expect(u.endOffset - u.startOffset).toBe(originalSlice.length);
    }
  });

  it('所有 unit 有 contentHash', () => {
    const s = new ParentChildSplitter(parentConfig, childConfig);
    const units = s.split('测试文本。另一个句子。');
    for (const u of units) {
      expect(u.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
