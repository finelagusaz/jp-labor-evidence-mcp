import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NormalizedCache, TTLCache } from '../src/lib/cache.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { observabilityRegistry } from '../src/lib/observability.js';
import { registerGetObservabilitySnapshotTool } from '../src/tools/get-observability-snapshot.js';
import { createToolResult } from '../src/lib/tool-contract.js';

const EGOV_GENERATED_AT = '2026-04-02T00:00:00.000Z';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('observability', () => {
  beforeEach(() => {
    observabilityRegistry.reset();
    indexMetadataRegistry.reset();
  });

  it('cache metrics を集計できる', () => {
    const cache = new TTLCache<string>('metrics_test', 60_000, 2);

    cache.get('missing');
    cache.set('a', '1');
    cache.get('a');
    cache.set('b', '2');
    cache.set('c', '3');

    const snapshot = observabilityRegistry.snapshot();
    const cacheMetrics = snapshot.caches.find((entry) => entry.name === 'metrics_test');

    expect(cacheMetrics).toBeDefined();
    expect(cacheMetrics?.misses).toBe(1);
    expect(cacheMetrics?.hits).toBe(1);
    expect(cacheMetrics?.evictions).toBe(1);
    expect(cacheMetrics?.kind).toBe('raw');
  });

  it('raw と normalized cache を区別して集計できる', () => {
    const rawCache = new TTLCache<string>('shared_name', 60_000, 2);
    const normalizedCache = new NormalizedCache<string>('normalized_metrics', {
      defaultTtlMs: 60_000,
      maxEntries: 2,
      maxBytes: 1000,
    });

    rawCache.set('a', '1');
    normalizedCache.set('a', '1');

    const snapshot = observabilityRegistry.snapshot();

    expect(snapshot.caches.find((entry) => entry.name === 'shared_name')?.kind).toBe('raw');
    expect(snapshot.caches.find((entry) => entry.name === 'normalized_metrics')?.kind).toBe('normalized');
  });

  it('observability snapshot tool が structuredContent を返す', async () => {
    observabilityRegistry.recordUpstreamRequest('egov', 123, 'success');
    observabilityRegistry.recordPartialFailure('jaish', 2);
    indexMetadataRegistry.recordSuccess('egov', '2026-04-02T00:00:00.000Z', 45);
    createToolResult(
      'resolve_law',
      {
        status: 'partial',
        retryable: false,
        degraded: true,
        warnings: [],
        partial_failures: [],
        data: { ok: true },
      },
      'partial',
      Date.now() - 10,
    );

    const registerTool = vi.fn();
    registerGetObservabilitySnapshotTool(createServerStub(registerTool));

    const [, config, handler] = registerTool.mock.calls[0];
    expect(config.outputSchema).toBeDefined();

    const result = await handler();

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.data?.upstreams[0]?.source).toBe('egov');
    expect(result.structuredContent.data?.indexes[0]?.source).toBe('egov');
    expect(result.structuredContent.data?.indexes[0]?.coverage_ratio).toBeUndefined();
    expect(result.structuredContent.data?.indexes[0]?.rollback_count).toBe(0);
    expect(result.structuredContent.data?.partial_failures.jaish).toBe(2);
    expect(result.structuredContent.data?.tools[0]?.tool).toBe('resolve_law');
    expect(result.structuredContent.data?.degraded_reasons.some((reason) => reason.source === 'jaish')).toBe(true);
  });

  it('stale index を degraded reason に含める', () => {
    indexMetadataRegistry.register({
      source: 'mhlw',
      generated_at: '2026-03-01T00:00:00.000Z',
      last_success_at: '2026-03-01T00:00:00.000Z',
      freshness: 'stale',
      entry_count: 10,
    });

    const snapshot = observabilityRegistry.snapshot();

    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degraded_reasons.some((reason) => reason.code === 'STALE_INDEX' && reason.source === 'mhlw')).toBe(true);
  });

  it('coverage が低い index を degraded reason に含める', () => {
    indexMetadataRegistry.register({
      source: 'jaish',
      generated_at: '2026-04-02T00:00:00.000Z',
      last_success_at: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
      entry_count: 3,
      coverage_ratio: 0.4,
      covered_years: [2024],
      query_hit_rate: 0.25,
      last_sync_scope: 'runtime_search_results',
      cold_start_minimum_scope: 'manual_sync_or_runtime_learning',
    });

    const snapshot = observabilityRegistry.snapshot();
    const index = snapshot.indexes.find((entry) => entry.source === 'jaish');

    expect(index?.covered_years).toEqual([2024]);
    expect(index?.query_hit_rate).toBe(0.25);
    expect(snapshot.degraded_reasons.some((reason) => reason.code === 'INDEX_COVERAGE_LOW' && reason.source === 'jaish')).toBe(true);
  });

  it('egov の snapshot に bundled_age_days が含まれる', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T00:00:00.000Z'));

    // Register egov meta without bundled_age_days (as register sites do)
    indexMetadataRegistry.register({
      source: 'egov',
      generated_at: EGOV_GENERATED_AT,
      last_success_at: EGOV_GENERATED_AT,
      freshness: 'unknown',
      entry_count: 100,
      last_sync_scope: 'bundled_registry',
    });

    const registerTool = vi.fn();
    registerGetObservabilitySnapshotTool(createServerStub(registerTool));
    const [, , handler] = registerTool.mock.calls[0];
    const result = await handler();

    const envelope = result.structuredContent as any;
    const egov = envelope.data.indexes.find((i: any) => i.source === 'egov');
    // 2026-04-12 - 2026-04-02 = 10 days
    expect(egov?.bundled_age_days).toBe(10);

    vi.useRealTimers();
  });
});
