/**
 * シンプルなインメモリTTLキャッシュ
 */

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(defaultTtlMs: number, maxEntries: number = 100) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });

    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// キャッシュインスタンス（セッション中共有）

/** 法令全文キャッシュ: TTL 1時間 */
export const lawDataCache = new TTLCache<string>(60 * 60 * 1000, 20);

/** 法令検索結果キャッシュ: TTL 30分 */
export const lawSearchCache = new TTLCache<string>(30 * 60 * 1000, 100);

/** MHLW 検索結果キャッシュ: TTL 30分 */
export const mhlwSearchCache = new TTLCache<string>(30 * 60 * 1000, 100);

/** MHLW 通達ページキャッシュ: TTL 1時間 */
export const mhlwDocCache = new TTLCache<string>(60 * 60 * 1000, 40);

/** JAISH インデックスキャッシュ: TTL 24時間 */
export const jaishIndexCache = new TTLCache<string>(24 * 60 * 60 * 1000, 32);

/** JAISH 通達ページキャッシュ: TTL 1時間 */
export const jaishPageCache = new TTLCache<string>(60 * 60 * 1000, 40);
