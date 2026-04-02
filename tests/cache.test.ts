import { describe, expect, it } from 'vitest';
import { NormalizedCache, TTLCache } from '../src/lib/cache.js';

describe('TTLCache', () => {
  it('maxEntries を超えたら古いキーから eviction する', () => {
    const cache = new TTLCache<string>('test', 60_000, 2);

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('同一キーの再設定で size が増えない', () => {
    const cache = new TTLCache<string>('test', 60_000, 2);

    cache.set('a', '1');
    cache.set('a', '2');

    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('2');
  });

  it('maxBytes を超える value は保存しない', () => {
    const cache = new NormalizedCache<string>('normalized_test', {
      defaultTtlMs: 60_000,
      maxEntries: 2,
      maxBytes: 10,
    });

    const stored = cache.set('a', '1234567890abcdef');

    expect(stored).toBe(false);
    expect(cache.size).toBe(0);
  });
});
