import { describe, expect, it } from 'vitest';
import { getEgovIndexMeta, resolveLawFromEgovIndex, searchEgovIndex } from '../src/lib/indexes/egov-index.js';

describe('egov index', () => {
  it('略称を内部索引から resolved できる', () => {
    const result = resolveLawFromEgovIndex('労基法');

    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0]?.lawId).toBe('322AC0000000049');
    expect(result.meta.freshness).toBe('fresh');
  });

  it('部分一致検索を内部索引で返せる', () => {
    const results = searchEgovIndex('労働', undefined, 10);

    expect(results.length).toBeGreaterThan(1);
    expect(results.some((entry) => entry.law_title === '労働基準法')).toBe(true);
  });

  it('索引メタデータを返せる', () => {
    const meta = getEgovIndexMeta();

    expect(meta.source).toBe('egov');
    expect(meta.entry_count).toBeGreaterThan(10);
    expect(meta.coverage_ratio).toBe(1);
  });
});
