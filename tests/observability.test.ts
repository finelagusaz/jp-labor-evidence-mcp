import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TTLCache } from '../src/lib/cache.js';
import { observabilityRegistry } from '../src/lib/observability.js';
import { registerGetObservabilitySnapshotTool } from '../src/tools/get-observability-snapshot.js';
import { createToolResult } from '../src/lib/tool-contract.js';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('observability', () => {
  beforeEach(() => {
    observabilityRegistry.reset();
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
  });

  it('observability snapshot tool が structuredContent を返す', async () => {
    observabilityRegistry.recordUpstreamRequest('egov', 123, 'success');
    observabilityRegistry.recordPartialFailure('jaish', 2);
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
    expect(result.structuredContent.data?.partial_failures.jaish).toBe(2);
    expect(result.structuredContent.data?.tools[0]?.tool).toBe('resolve_law');
    expect(result.structuredContent.data?.degraded_reasons.some((reason) => reason.source === 'jaish')).toBe(true);
  });
});
