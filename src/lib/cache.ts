/**
 * シンプルなインメモリTTLキャッシュ
 */

import { observabilityRegistry } from './observability.js';

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly name: string;

  constructor(name: string, defaultTtlMs: number, maxEntries: number = 100) {
    this.name = name;
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      observabilityRegistry.recordCacheMiss(this.name);
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      observabilityRegistry.recordCacheMiss(this.name);
      return undefined;
    }
    observabilityRegistry.recordCacheHit(this.name);
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
    observabilityRegistry.recordCacheWrite(this.name, this.estimatedBytes, this.cache.size);

    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      observabilityRegistry.recordCacheEviction(this.name, this.cache.size, this.estimatedBytes);
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

  get estimatedBytes(): number {
    let total = 0;
    for (const [key, entry] of this.cache.entries()) {
      total += key.length * 2;
      total += estimateValueSize(entry.value);
      total += 16;
    }
    return total;
  }
}

function estimateValueSize(value: unknown): number {
  if (typeof value === 'string') {
    return value.length * 2;
  }

  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

// キャッシュインスタンス（セッション中共有）

/** 法令全文キャッシュ: TTL 1時間 */
export const lawDataCache = new TTLCache<string>('law_data', 60 * 60 * 1000, 20);

/** 法令検索結果キャッシュ: TTL 30分 */
export const lawSearchCache = new TTLCache<string>('law_search', 30 * 60 * 1000, 100);

/** MHLW 検索結果キャッシュ: TTL 30分 */
export const mhlwSearchCache = new TTLCache<string>('mhlw_search', 30 * 60 * 1000, 100);

/** MHLW 通達ページキャッシュ: TTL 1時間 */
export const mhlwDocCache = new TTLCache<string>('mhlw_doc', 60 * 60 * 1000, 40);

/** JAISH インデックスキャッシュ: TTL 24時間 */
export const jaishIndexCache = new TTLCache<string>('jaish_index', 24 * 60 * 60 * 1000, 32);

/** JAISH 通達ページキャッシュ: TTL 1時間 */
export const jaishPageCache = new TTLCache<string>('jaish_page', 60 * 60 * 1000, 40);
