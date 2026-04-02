import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from '../src/lib/cache.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

vi.mock('../src/lib/mhlw-client.js', () => ({
  fetchMhlwSearch: vi.fn(),
  fetchMhlwDocument: vi.fn(),
  getMhlwDocUrl: (dataId: string, pageNo = 1) =>
    `https://www.mhlw.go.jp/web/t_doc?dataId=${dataId}&dataType=1&pageNo=${pageNo}`,
}));

import { fetchMhlwSearch } from '../src/lib/mhlw-client.js';
import { searchMhlwTsutatsu } from '../src/lib/services/mhlw-tsutatsu-service.js';

function readFixture(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('mhlw-tsutatsu-service fixtures', () => {
  const successHtml = readFixture('tests/fixtures/mhlw/search-success.html');

  beforeEach(() => {
    vi.resetAllMocks();
    clearAllCaches();
    tsutatsuIndexRegistry.reset();
    indexMetadataRegistry.reset();
  });

  it('検索成功時は ok と結果一覧を返す', async () => {
    vi.mocked(fetchMhlwSearch).mockResolvedValue(successHtml);

    const result = await searchMhlwTsutatsu({
      keyword: '足場',
      page: 0,
    });

    expect(result.status).toBe('ok');
    expect(result.totalCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.partialFailures).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('upstream 失敗時は unavailable を返す', async () => {
    vi.mocked(fetchMhlwSearch).mockRejectedValue(new Error('timeout'));

    const result = await searchMhlwTsutatsu({
      keyword: '足場',
      page: 0,
    });

    expect(result.status).toBe('unavailable');
    expect(result.results).toHaveLength(0);
    expect(result.partialFailures).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('MHLW_SEARCH_UNAVAILABLE');
  });

  it('既知候補が index にあれば upstream を呼ばずに返す', async () => {
    vi.mocked(fetchMhlwSearch).mockResolvedValue(successHtml);
    await searchMhlwTsutatsu({
      keyword: '足場',
      page: 0,
    });

    vi.mocked(fetchMhlwSearch).mockClear();

    const result = await searchMhlwTsutatsu({
      keyword: '足場',
      page: 0,
    });

    expect(result.status).toBe('ok');
    expect(result.usedIndex).toBe(true);
    expect(fetchMhlwSearch).not.toHaveBeenCalled();
    expect(result.indexMeta?.source).toBe('mhlw');
  });
});
