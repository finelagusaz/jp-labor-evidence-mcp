import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { clearAllCaches } from '../src/lib/cache.js';
import { initializeIndexes } from '../src/lib/indexes/bootstrap.js';
import { getIndexFilePath } from '../src/lib/indexes/index-store.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

describe('index bootstrap', () => {
  let tempDir: string;
  let previousIndexDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-indexes-'));
    previousIndexDir = process.env.LABOR_LAW_MCP_INDEX_DIR;
    process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
    clearAllCaches();
    tsutatsuIndexRegistry.reset();
    indexMetadataRegistry.reset();
  });

  afterEach(() => {
    if (previousIndexDir === undefined) {
      delete process.env.LABOR_LAW_MCP_INDEX_DIR;
    } else {
      process.env.LABOR_LAW_MCP_INDEX_DIR = previousIndexDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('起動時に egov index を永続化する', () => {
    initializeIndexes();

    expect(existsSync(getIndexFilePath('egov'))).toBe(true);
  });

  it('永続化済み tsutatsu index を起動時に読み込む', () => {
    tsutatsuIndexRegistry.recordMhlwResults([
      {
        title: '足場の安全基準について',
        dataId: '00tb2035',
        date: '2024-01-01',
        shubetsu: '基発0101第1号',
      },
    ], '2026-04-02T00:00:00.000Z');

    tsutatsuIndexRegistry.reset();
    indexMetadataRegistry.reset();

    initializeIndexes();

    const result = tsutatsuIndexRegistry.search('mhlw', '足場', 10);
    expect(result.results[0]?.title).toBe('足場の安全基準について');
    expect(result.meta?.source).toBe('mhlw');
  });
});
