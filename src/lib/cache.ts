/**
 * インメモリキャッシュ
 *
 * - raw: upstream 応答の短期保持
 * - normalized: 正規化済み構造化データの再利用
 */

import { observabilityRegistry } from './observability.js';

interface CacheEntry<T> {
  value: T;
  expires: number;
}

interface MemoryCacheOptions {
  defaultTtlMs: number;
  maxEntries?: number;
  maxBytes?: number;
}

export type CacheKind = 'raw' | 'normalized';
const registeredCaches = new Set<MemoryCache<unknown>>();

export class MemoryCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    readonly name: string,
    readonly kind: CacheKind,
    options: MemoryCacheOptions,
  ) {
    this.defaultTtlMs = options.defaultTtlMs;
    this.maxEntries = options.maxEntries ?? 100;
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    registeredCaches.add(this as MemoryCache<unknown>);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      observabilityRegistry.recordCacheMiss(this.name, this.kind);
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      observabilityRegistry.recordCacheMiss(this.name, this.kind);
      return undefined;
    }
    observabilityRegistry.recordCacheHit(this.name, this.kind);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): boolean {
    const entryBytes = estimateEntrySize(key, value);
    if (entryBytes > this.maxBytes) {
      return false;
    }

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });

    while (this.cache.size > this.maxEntries || this.estimatedBytes > this.maxBytes) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
      observabilityRegistry.recordCacheEviction(this.name, this.kind, this.cache.size, this.estimatedBytes);
    }

    observabilityRegistry.recordCacheWrite(this.name, this.kind, this.estimatedBytes, this.cache.size);
    return true;
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
      total += estimateEntrySize(key, entry.value);
      total += 16;
    }
    return total;
  }
}

export class RawResponseCache<T> extends MemoryCache<T> {
  constructor(name: string, options: MemoryCacheOptions) {
    super(name, 'raw', options);
  }
}

export class NormalizedCache<T> extends MemoryCache<T> {
  constructor(name: string, options: MemoryCacheOptions) {
    super(name, 'normalized', options);
  }
}

// 既存テスト互換のため残す。新規利用では RawResponseCache / NormalizedCache を使う。
export class TTLCache<T> extends RawResponseCache<T> {
  constructor(name: string, defaultTtlMs: number, maxEntries = 100, maxBytes?: number) {
    super(name, {
      defaultTtlMs,
      maxEntries,
      maxBytes,
    });
  }
}

export function clearAllCaches(): void {
  for (const cache of registeredCaches) {
    cache.clear();
  }
}

function estimateEntrySize(key: string, value: unknown): number {
  return key.length * 2 + estimateValueSize(value);
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

/** raw: e-Gov 法令全文 JSON */
export const lawDataRawCache = new RawResponseCache<string>('law_data', {
  defaultTtlMs: 60 * 60 * 1000,
  maxEntries: 20,
  maxBytes: 2_000_000,
});

/** raw: e-Gov 法令検索 JSON */
export const lawSearchRawCache = new RawResponseCache<string>('law_search', {
  defaultTtlMs: 30 * 60 * 1000,
  maxEntries: 100,
  maxBytes: 2_000_000,
});

/** raw: MHLW 検索結果 HTML */
export const mhlwSearchRawCache = new RawResponseCache<string>('mhlw_search', {
  defaultTtlMs: 30 * 60 * 1000,
  maxEntries: 100,
  maxBytes: 2_000_000,
});

/** raw: MHLW 通達本文 HTML */
export const mhlwDocRawCache = new RawResponseCache<string>('mhlw_doc', {
  defaultTtlMs: 60 * 60 * 1000,
  maxEntries: 40,
  maxBytes: 2_000_000,
});

/** raw: JAISH 年度インデックス HTML */
export const jaishIndexRawCache = new RawResponseCache<string>('jaish_index', {
  defaultTtlMs: 24 * 60 * 60 * 1000,
  maxEntries: 32,
  maxBytes: 2_000_000,
});

/** raw: JAISH 個別本文 HTML */
export const jaishPageRawCache = new RawResponseCache<string>('jaish_page', {
  defaultTtlMs: 60 * 60 * 1000,
  maxEntries: 40,
  maxBytes: 2_000_000,
});
