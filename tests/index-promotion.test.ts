import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLawIndexEntry, buildMhlwIndexEntry } from '../src/lib/indexes/builders.js';
import { getIndexFilePath, getLastKnownGoodIndexFilePath, getStagedIndexFilePath, loadLawIndexSnapshot, saveLawIndexSnapshot } from '../src/lib/indexes/index-store.js';
import { IndexPromotionError, promoteLawIndexSnapshot, promoteTsutatsuIndexSnapshot } from '../src/lib/indexes/promotion.js';

describe('index promotion', () => {
  let tempDir: string;
  let previousIndexDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-promotion-'));
    previousIndexDir = process.env.LABOR_LAW_MCP_INDEX_DIR;
    process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
  });

  afterEach(() => {
    if (previousIndexDir === undefined) {
      delete process.env.LABOR_LAW_MCP_INDEX_DIR;
    } else {
      process.env.LABOR_LAW_MCP_INDEX_DIR = previousIndexDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stage を経由して snapshot を promote できる', () => {
    const promoted = promoteLawIndexSnapshot('egov', {
      meta: {
        source: 'egov',
        generated_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 1,
      },
      entries: [
        buildLawIndexEntry({
          lawId: '322AC0000000049',
          lawTitle: '労働基準法',
          lawType: 'Act',
          sourceUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
          freshness: 'fresh',
        }),
      ],
    });

    expect(existsSync(getIndexFilePath('egov'))).toBe(true);
    expect(existsSync(getStagedIndexFilePath('egov'))).toBe(false);
    expect(existsSync(getLastKnownGoodIndexFilePath('egov'))).toBe(true);
    expect(promoted.meta.snapshot_id).toBeDefined();
    expect(promoted.meta.active_snapshot_id).toBe(promoted.meta.snapshot_id);
    expect(promoted.meta.last_promotion_at).toBeDefined();
    expect(promoted.meta.last_known_good_at).toBeDefined();
    expect(loadLawIndexSnapshot('egov')?.meta.snapshot_id).toBe(promoted.meta.snapshot_id);
  });

  it('entry_count が急減する snapshot の promote を拒否する', () => {
    saveLawIndexSnapshot('egov', {
      meta: {
        source: 'egov',
        generated_at: '2026-04-01T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 10,
      },
      entries: Array.from({ length: 10 }, (_, index) =>
        buildLawIndexEntry({
          lawId: `law-${index}`,
          lawTitle: `法令${index}`,
          lawType: 'Act',
          sourceUrl: `https://example.test/law-${index}`,
          freshness: 'fresh',
        })
      ),
    });

    expect(() =>
      promoteLawIndexSnapshot('egov', {
        meta: {
          source: 'egov',
          generated_at: '2026-04-02T00:00:00.000Z',
          freshness: 'fresh',
          entry_count: 3,
        },
        entries: Array.from({ length: 3 }, (_, index) =>
          buildLawIndexEntry({
            lawId: `small-${index}`,
            lawTitle: `小法令${index}`,
            lawType: 'Act',
            sourceUrl: `https://example.test/small-${index}`,
            freshness: 'fresh',
          })
        ),
      })
    ).toThrow(IndexPromotionError);

    expect(loadLawIndexSnapshot('egov')?.entries).toHaveLength(10);
    expect(existsSync(getStagedIndexFilePath('egov'))).toBe(false);
  });

  it('coverage 低下が大きい tsutatsu snapshot の promote を拒否する', () => {
    const initial = promoteTsutatsuIndexSnapshot('mhlw', {
      meta: {
        source: 'mhlw',
        generated_at: '2026-04-01T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 1,
        coverage_ratio: 0.9,
      },
      entries: [
        buildMhlwIndexEntry({
          title: '足場の安全基準について',
          dataId: '00tb2035',
          date: '2024-01-01',
          shubetsu: '基発0101第1号',
        }, 'fresh'),
      ],
    });

    expect(initial.meta.last_promotion_at).toBeDefined();

    expect(() =>
      promoteTsutatsuIndexSnapshot('mhlw', {
        meta: {
          source: 'mhlw',
          generated_at: '2026-04-02T00:00:00.000Z',
          freshness: 'fresh',
          entry_count: 1,
          coverage_ratio: 0.5,
        },
        entries: [
          buildMhlwIndexEntry({
            title: '足場の安全基準について',
            dataId: '00tb2035',
            date: '2024-01-01',
            shubetsu: '基発0101第1号',
          }, 'fresh'),
        ],
      })
    ).toThrow(IndexPromotionError);
  });
});
