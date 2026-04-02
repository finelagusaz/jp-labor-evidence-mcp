import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from '../src/lib/cache.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

vi.mock('../src/lib/jaish-client.js', () => ({
  JAISH_INDEX_PAGES: ['/fixture/success.html', '/fixture/fail.html'],
  fetchJaishIndex: vi.fn(),
  fetchJaishPage: vi.fn(),
  getJaishUrl: (path: string) => `https://www.jaish.gr.jp${path}`,
}));

import { fetchJaishIndex } from '../src/lib/jaish-client.js';
import { searchJaishTsutatsu } from '../src/lib/services/jaish-tsutatsu-service.js';

function readFixture(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('jaish-tsutatsu-service fixtures', () => {
  const successHtml = readFixture('tests/fixtures/jaish/index-success.html');

  beforeEach(() => {
    vi.resetAllMocks();
    clearAllCaches();
    tsutatsuIndexRegistry.reset();
    indexMetadataRegistry.reset();
  });

  it('一部年度が失敗しても partial として結果を返す', async () => {
    vi.mocked(fetchJaishIndex).mockImplementation(async (path: string) => {
      if (path === '/fixture/success.html') return successHtml;
      throw new Error('timeout');
    });

    const result = await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    expect(result.status).toBe('partial');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toContain('足場');
    expect(result.failedPages).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('JAISH_SEARCH_PARTIAL');
    expect(result.route).toBe('upstream_fallback');
  });

  it('全年度失敗なら unavailable を返す', async () => {
    vi.mocked(fetchJaishIndex).mockRejectedValue(new Error('upstream down'));

    const result = await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    expect(result.status).toBe('unavailable');
    expect(result.results).toHaveLength(0);
    expect(result.failedPages).toHaveLength(2);
    expect(result.warnings[0]?.code).toBe('JAISH_SEARCH_UNAVAILABLE');
    expect(result.route).toBe('upstream_fallback');
  });

  it('既知候補が index にあれば upstream を呼ばずに返す', async () => {
    vi.mocked(fetchJaishIndex).mockResolvedValue(successHtml);
    await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    vi.mocked(fetchJaishIndex).mockClear();

    const result = await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    expect(result.status).toBe('ok');
    expect(result.usedIndex).toBe(true);
    expect(fetchJaishIndex).not.toHaveBeenCalled();
    expect(result.indexMeta?.source).toBe('jaish');
    expect(result.route).toBe('index_only');
  });

  it('stale index でも既知候補は stale_but_usable で返す', async () => {
    vi.mocked(fetchJaishIndex).mockResolvedValue(successHtml);
    await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    indexMetadataRegistry.register({
      source: 'jaish',
      generated_at: '2026-03-01T00:00:00.000Z',
      freshness: 'stale',
      entry_count: 1,
      coverage_ratio: 1,
    });

    vi.mocked(fetchJaishIndex).mockClear();

    const result = await searchJaishTsutatsu({
      keyword: '足場',
      maxPages: 2,
    });

    expect(result.route).toBe('stale_but_usable');
    expect(result.usedIndex).toBe(true);
    expect(fetchJaishIndex).not.toHaveBeenCalled();
  });
});
