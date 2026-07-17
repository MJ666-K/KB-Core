import { describe, it, expect } from 'bun:test';
import { countTokens } from '@features/kb/splitter/token-counter';

describe('countTokens', () => {
  it('纯中文：约1.5字/token', () => {
    expect(countTokens('你好世界这是一个测试')).toBe(Math.ceil(10 / 1.5));
  });
  it('纯英文：约4字符/token', () => {
    expect(countTokens('Hello World')).toBe(Math.ceil(11 / 4));
  });
  it('中英混合', () => {
    expect(countTokens('Docker 是一个容器平台')).toBe(Math.ceil(5 / 1.5 + 12 / 4));
  });
  it('空字符串返回 0', () => {
    expect(countTokens('')).toBe(0);
  });
});
