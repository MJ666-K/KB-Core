import { describe, it, expect } from 'bun:test';
import { TTLCache } from '../src/cache/ttl-cache';

describe('TTLCache', () => {
  it('TTL 基本功能', () => {
    const cache = new TTLCache<string, number>(60_000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('过期后返回 undefined', async () => {
    const cache = new TTLCache<string, number>(50);
    cache.set('a', 1);
    await new Promise(r => setTimeout(r, 100));
    expect(cache.get('a')).toBeUndefined();
  });

  it('LRU：超容量时淘汰最旧', () => {
    const cache = new TTLCache<string, number>(60_000, 3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 访问 a，让 a 移到末尾，b 变最旧
    cache.get('a');
    // 插入 d，应该淘汰 b（最久未访问）
    cache.set('d', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('delete 删除指定 key', () => {
    const cache = new TTLCache<string, number>(60_000);
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('clear 清空所有', () => {
    const cache = new TTLCache<string, number>(60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('重复 set 同一 key 更新值', () => {
    const cache = new TTLCache<string, number>(60_000);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });
});
