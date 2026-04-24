import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('egov index', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // within STALE_AFTER_MS window of GENERATED_AT (src/lib/indexes/egov-index.ts)
    vi.setSystemTime(new Date('2026-04-02T12:00:00.000Z'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('略称を内部索引から resolved できる', async () => {
    const { resolveLawFromEgovIndex } = await import('../src/lib/indexes/egov-index.js');
    const result = resolveLawFromEgovIndex('労基法');

    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0]?.lawId).toBe('322AC0000000049');
    expect(result.meta.freshness).toBe('fresh');
  });

  it('部分一致検索を内部索引で返せる', async () => {
    const { searchEgovIndex } = await import('../src/lib/indexes/egov-index.js');
    const results = searchEgovIndex('労働', undefined, 10);

    expect(results.length).toBeGreaterThan(1);
    expect(results.some((entry) => entry.law_title === '労働基準法')).toBe(true);
  });

  it('索引メタデータを返せる', async () => {
    const { getEgovIndexMeta } = await import('../src/lib/indexes/egov-index.js');
    const meta = getEgovIndexMeta();

    expect(meta.source).toBe('egov');
    expect(meta.entry_count).toBeGreaterThan(10);
    expect(meta.coverage_ratio).toBe(1);
  });
});
