import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLawIndexEntry, buildMhlwIndexEntry } from '../src/lib/indexes/builders.js';
import { createIncrementalSyncPlan, detectEgovChanges, detectTsutatsuChanges } from '../src/lib/indexes/change-detectors.js';
import { saveLawIndexSnapshot, saveTsutatsuIndexSnapshot } from '../src/lib/indexes/index-store.js';

describe('change detectors', () => {
  let tempDir: string;
  let previousIndexDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-detectors-'));
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

  it('egov は bundled index が新しければ updated を返す', () => {
    saveLawIndexSnapshot('egov', {
      meta: {
        source: 'egov',
        generated_at: '2026-04-01T00:00:00.000Z',
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

    const summary = detectEgovChanges();

    expect(summary.source).toBe('egov');
    expect(summary.updated).toBeGreaterThan(0);
    expect(summary.should_full_rebuild).toBe(false);
    expect(summary.reason).toBe('BUNDLED_INDEX_NEWER');
  });

  it('mhlw は coverage が低いと full rebuild を要求する', () => {
    saveTsutatsuIndexSnapshot('mhlw', {
      meta: {
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 1,
        coverage_ratio: 0.4,
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

    const summary = detectTsutatsuChanges('mhlw');

    expect(summary.should_full_rebuild).toBe(true);
    expect(summary.reason).toBe('COVERAGE_BELOW_THRESHOLD');
    expect(summary.unknown).toBe(1);
  });

  it('unknown がある source を含むと incremental plan は full rebuild に倒す', () => {
    const plan = createIncrementalSyncPlan();

    expect(plan.should_full_rebuild).toBe(true);
    expect(plan.summaries.some((summary) => summary.reason === 'NO_BASELINE')).toBe(true);
  });
});
