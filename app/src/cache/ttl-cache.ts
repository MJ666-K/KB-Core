/**
 * TTL + LRU 混合缓存。
 * - TTL：超过时间自动失效（lazy，get 时检查）
 * - LRU：达到 maxSize 时淘汰最久未访问的
 *
 * 利用 JS Map 的插入顺序特性实现 LRU：
 * - get 时 delete + set，让被访问的 key 移到末尾
 * - 淘汰时删 Map.keys().next().value（头部 = 最旧）
 */
export class TTLCache<K, V> {
  private store = new Map<K, { expiresAt: number; value: V }>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs: number, maxSize: number = 1000) {
    if (maxSize <= 0) throw new Error('maxSize must be positive');
    if (ttlMs <= 0) throw new Error('ttlMs must be positive');
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // 过期了：删除并返回 undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // LRU：delete + set 把 key 移到 Map 末尾（=最近访问）
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // 已存在先删除，保证 set 后在末尾
    this.store.delete(key);

    // 容量超限：淘汰 Map 头部（最旧、最久未访问）
    while (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }

    this.store.set(key, { expiresAt: Date.now() + this.ttlMs, value });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
