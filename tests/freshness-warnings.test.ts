import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_AT_MS = Date.parse('2026-04-02T00:00:00.000Z');

describe('freshness-warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GENERATED_AT_MS));
    indexMetadataRegistry.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getBundledIndexWarnings', () => {
    it('59日以下では空配列を返す', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 59 * DAY;
      expect(getBundledIndexWarnings(now)).toEqual([]);
    });

    it('60日ちょうどでは空配列を返す（閾値は strict greater）', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 60 * DAY;
      expect(getBundledIndexWarnings(now)).toEqual([]);
    });

    it('60日を超えると BUNDLED_INDEX_AGED を返す', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getBundledIndexWarnings(now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('BUNDLED_INDEX_AGED');
      expect(warnings[0]?.source).toBe('egov');
      expect(warnings[0]?.message).toContain('61 日');
      expect(warnings[0]?.message).toContain('再起動');
      expect(warnings[0]?.message).toContain('npm update -g jp-labor-evidence-mcp');
    });
  });

  describe('getRuntimeIndexWarnings', () => {
    it('registry に meta がない場合は空配列を返す', async () => {
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      expect(getRuntimeIndexWarnings('mhlw', GENERATED_AT_MS)).toEqual([]);
    });

    it('generated_at から 7日以内なら空配列を返す', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 6 * DAY;
      expect(getRuntimeIndexWarnings('mhlw', now)).toEqual([]);
    });

    it('generated_at から 7日を超えると RUNTIME_INDEX_STALE を返す（mhlw）', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getRuntimeIndexWarnings('mhlw', now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('RUNTIME_INDEX_STALE');
      expect(warnings[0]?.source).toBe('mhlw');
      expect(warnings[0]?.message).toContain('厚生労働省通達');
      expect(warnings[0]?.message).toContain('8日前');
      expect(warnings[0]?.message).toContain('再検索');
    });

    it('jaish にも同じ判定を適用する', async () => {
      indexMetadataRegistry.register({
        source: 'jaish',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getRuntimeIndexWarnings('jaish', now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.source).toBe('jaish');
      expect(warnings[0]?.message).toContain('JAISH');
    });
  });

  describe('getIndexWarningsForTool', () => {
    it('egov のみ: bundled warning のみ返す', async () => {
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getIndexWarningsForTool(['egov'], now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('BUNDLED_INDEX_AGED');
    });

    it('mhlw のみ: mhlw stale のみ返す', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getIndexWarningsForTool(['mhlw'], now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('RUNTIME_INDEX_STALE');
      expect(warnings[0]?.source).toBe('mhlw');
    });

    it('multi-source: 該当するものを順に合成する', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      indexMetadataRegistry.register({
        source: 'jaish',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getIndexWarningsForTool(['egov', 'mhlw', 'jaish'], now);
      expect(warnings).toHaveLength(3);
      expect(warnings.map((w) => w.source)).toEqual(['egov', 'mhlw', 'jaish']);
    });

    it('全て fresh なら空配列', async () => {
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 3 * DAY;
      expect(getIndexWarningsForTool(['egov'], now)).toEqual([]);
    });
  });

  describe('emitStartupWarnings', () => {
    it('aged なら sendLoggingMessage と console.error を呼ぶ', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 61 * DAY;

      await emitStartupWarnings({ sendLoggingMessage } as any, now);

      expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
      expect(sendLoggingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          logger: 'jp-labor-evidence-mcp',
          data: expect.stringContaining('内蔵法令インデックス'),
        })
      );
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[jp-labor-evidence-mcp] WARNING'));

      stderrSpy.mockRestore();
    });

    it('aged でないなら何もしない', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn();
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 10 * DAY;

      await emitStartupWarnings({ sendLoggingMessage } as any, now);

      expect(sendLoggingMessage).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('sendLoggingMessage が reject しても throw しない', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn().mockRejectedValue(new Error('transport closed'));
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 61 * DAY;

      await expect(emitStartupWarnings({ sendLoggingMessage } as any, now)).resolves.toBeUndefined();
      expect(stderrSpy).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });
});
