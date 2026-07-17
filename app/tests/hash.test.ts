import { describe, it, expect } from 'bun:test';
import { sha256 } from '@core/utils/hash';

describe('sha256', () => {
  it('相同输入相同输出', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('不同输入不同输出', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('输出 64 位 hex', () => {
    expect(sha256('test')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('空字符串也能 hash', () => {
    expect(sha256('')).toMatch(/^[a-f0-9]{64}$/);
  });
});
