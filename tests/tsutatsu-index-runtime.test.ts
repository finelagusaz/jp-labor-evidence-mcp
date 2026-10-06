import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCaches } from '../src/lib/cache.js';
import { buildMhlwIndexEntry } from '../src/lib/indexes/builders.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { getIndexFilePath, loadTsutatsuIndexSnapshot } from '../src/lib/indexes/index-store.js';
import { promoteTsutatsuIndexSnapshot } from '../src/lib/indexes/promotion.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

vi.mock('../src/lib/mhlw-client.js', () => ({
  fetchMhlwSearch: vi.fn(),
  fetchMhlwDocument: vi.fn(),
  getMhlwDocUrl: (dataId: string, pageNo = 1) =>
    `https://www.mhlw.go.jp/web/t_doc?dataId=${dataId}&dataType=1&pageNo=${pageNo}`,
}));

import { fetchMhlwSearch } from '../src/lib/mhlw-client.js';
import { searchMhlwTsutatsu } from '../src/lib/services/mhlw-tsutatsu-service.js';

const successHtml = readFileSync(resolve(process.cwd(), 'tests/fixtures/mhlw/search-success.html'), 'utf-8');

/** 別のプロセスが学習してディスクに書いた索引（count 件）を用意する */
function writeDiskIndexFromAnotherProcess(count: number) {
  const entries = Array.from({ length: count }, (_, i) =>
    buildMhlwIndexEntry({ title: `別プロセスが学習した通達${i}`, dataId: `other${i}`, date: '令和7年4月1日', shubetsu: '基発' }, 'fresh'),
  );
  promoteTsutatsuIndexSnapshot('mhlw', {
    meta: { source: 'mhlw', generated_at: '2026-10-01T00:00:00.000Z', freshness: 'fresh', entry_count: count },
    entries,
  });
}

describe('通達の runtime 索引: 検索のたびの反映', () => {
  let tempDir: string;
  let previousIndexDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-runtime-index-'));
    previousIndexDir = process.env.LABOR_LAW_MCP_INDEX_DIR;
    process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
    vi.resetAllMocks();
    clearAllCaches();
    tsutatsuIndexRegistry.reset();
    indexMetadataRegistry.reset();
  });

  afterEach(() => {
    if (previousIndexDir === undefined) delete process.env.LABOR_LAW_MCP_INDEX_DIR;
    else process.env.LABOR_LAW_MCP_INDEX_DIR = previousIndexDir;
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('ディスクに別プロセスの学習分が多くあっても、取り込んでから保存するので失敗せず、学習分も消さない', async () => {
    writeDiskIndexFromAnotherProcess(30);
    vi.mocked(fetchMhlwSearch).mockResolvedValue(successHtml);

    // このプロセスのメモリは空（起動後に別プロセスが学習した状況）
    const result = await searchMhlwTsutatsu({ keyword: '足場', page: 0 });

    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(2);
    const disk = loadTsutatsuIndexSnapshot('mhlw');
    expect(disk?.entries).toHaveLength(32);
    expect(tsutatsuIndexRegistry.search('mhlw', '別プロセスが学習した通達29', 5).results).toHaveLength(1);
  });

  it('索引の反映に失敗しても検索結果は返し、失敗は stderr に記録する', async () => {
    writeDiskIndexFromAnotherProcess(30);
    // 現行の索引ファイルを壊して、反映（promotion）が必ず失敗する状態にする
    writeFileSync(getIndexFilePath('mhlw'), '{ broken');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchMhlwSearch).mockResolvedValue(successHtml);

    const result = await searchMhlwTsutatsu({ keyword: '足場', page: 0 });

    expect(result.status).toBe('ok');
    expect(result.results).toHaveLength(2);
    expect(result.partialFailures).toEqual([]);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[jp-labor-evidence-mcp]'), expect.anything());
  });

  it('上流の失敗を記録する経路でも、索引の反映の失敗で例外にしない', async () => {
    writeDiskIndexFromAnotherProcess(30);
    writeFileSync(getIndexFilePath('mhlw'), '{ broken');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchMhlwSearch).mockRejectedValue(new Error('timeout'));

    const result = await searchMhlwTsutatsu({ keyword: '足場', page: 0 });

    expect(result.status).toBe('unavailable');
    expect(result.warnings[0]?.code).toBe('MHLW_SEARCH_UNAVAILABLE');
  });

  it('保守用の persist は従来どおり失敗を例外で知らせる', () => {
    writeDiskIndexFromAnotherProcess(30);
    expect(() => tsutatsuIndexRegistry.persist('mhlw')).toThrow(/Failed to promote/);
  });
});
