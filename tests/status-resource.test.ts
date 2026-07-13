import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';

const GENERATED_AT_ISO = '2026-07-13T00:00:00.000Z';
const GENERATED_AT_MS = Date.parse(GENERATED_AT_ISO);
const DAY = 24 * 60 * 60 * 1000;

describe('status resource (mcp://jp-labor-evidence-mcp/status)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GENERATED_AT_MS));
    indexMetadataRegistry.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('fresh 状態: version・egov メタを返し active_warnings は空', async () => {
    const { buildServerStatus } = await import('../src/resources/status.js');
    const status = buildServerStatus('9.9.9', GENERATED_AT_MS);
    expect(status.package_version).toBe('9.9.9');
    expect(status.indexes.egov.generated_at).toBe(GENERATED_AT_ISO);
    expect(status.indexes.egov.bundled_age_days).toBe(0);
    expect(status.indexes.egov.warning_code).toBeUndefined();
    expect(status.active_warnings).toEqual([]);
    expect(status.freshness_warnings_suppressed).toBe(false);
  });

  it('egov age は注入した now の純関数（wall-clock 非依存）', async () => {
    const { buildServerStatus } = await import('../src/resources/status.js');
    // system time は GENERATED_AT のままだが、now=+61d を渡すと age=61
    const status = buildServerStatus('9.9.9', GENERATED_AT_MS + 61 * DAY);
    expect(status.indexes.egov.bundled_age_days).toBe(61);
    expect(status.indexes.egov.warning_code).toBe('BUNDLED_INDEX_AGED');
    expect(
      status.active_warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED' && w.source === 'egov'),
    ).toBe(true);
  });

  it('runtime stale: mhlw の freshness/warning_code と active_warnings を反映', async () => {
    indexMetadataRegistry.register({
      source: 'mhlw',
      generated_at: GENERATED_AT_ISO,
      last_success_at: GENERATED_AT_ISO,
      freshness: 'fresh',
      entry_count: 5,
    });
    const { buildServerStatus } = await import('../src/resources/status.js');
    const status = buildServerStatus('9.9.9', GENERATED_AT_MS + 8 * DAY);
    expect(status.indexes.mhlw?.warning_code).toBe('RUNTIME_INDEX_STALE');
    expect(status.active_warnings.some((w) => w.source === 'mhlw')).toBe(true);
  });

  it('未登録の runtime index は null', async () => {
    const { buildServerStatus } = await import('../src/resources/status.js');
    const status = buildServerStatus('9.9.9', GENERATED_AT_MS);
    expect(status.indexes.jaish).toBeNull();
  });

  it('抑止中でも active_warnings は真の状態を出し、フラグは true', async () => {
    vi.stubEnv('LABOR_LAW_MCP_SUPPRESS_FRESHNESS_WARNINGS', '1');
    const { buildServerStatus } = await import('../src/resources/status.js');
    const status = buildServerStatus('9.9.9', GENERATED_AT_MS + 61 * DAY);
    expect(status.freshness_warnings_suppressed).toBe(true);
    // 抑止は tool response 用。status resource は真の状態を surface する
    expect(status.active_warnings.length).toBeGreaterThan(0);
  });

  it('createServer はリソース登録を含めエラーなく構築できる', async () => {
    const { createServer } = await import('../src/server.js');
    expect(() => createServer()).not.toThrow();
  });
});
