import { describe, it, expect } from 'bun:test';
import { extractSearchTerms } from '../src/retrieve/sparse-terms';

describe('extractSearchTerms', () => {
  it('提取中文法律关键词', () => {
    const terms = extractSearchTerms('劳动合同法关于加班的规定');
    expect(terms.some(t => t.includes('劳动合同法') || t.includes('加班'))).toBe(true);
  });

  it('提取英文词', () => {
    const terms = extractSearchTerms('GDPR privacy law');
    expect(terms).toContain('gdpr');
    expect(terms).toContain('privacy');
  });

  it('空查询返回空', () => {
    expect(extractSearchTerms('   ')).toEqual([]);
  });
});
