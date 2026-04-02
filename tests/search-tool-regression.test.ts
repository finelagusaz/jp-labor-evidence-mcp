import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/lib/services/mhlw-tsutatsu-service.js', () => ({
  searchMhlwTsutatsu: vi.fn(),
}));

vi.mock('../src/lib/services/jaish-tsutatsu-service.js', () => ({
  searchJaishTsutatsu: vi.fn(),
}));

import { searchMhlwTsutatsu } from '../src/lib/services/mhlw-tsutatsu-service.js';
import { searchJaishTsutatsu } from '../src/lib/services/jaish-tsutatsu-service.js';
import { registerSearchMhlwTsutatsuTool } from '../src/tools/search-mhlw-tsutatsu.js';
import { registerSearchJaishTsutatsuTool } from '../src/tools/search-jaish-tsutatsu.js';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('search tool regression', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('search_mhlw_tsutatsu は coverage_below_threshold を structuredContent に保持する', async () => {
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'partial',
      results: [],
      totalCount: 0,
      page: 0,
      partialFailures: [],
      warnings: [{
        code: 'INDEX_COVERAGE_LOW',
        message: '内部 index の coverage が低いため fallback を抑止しました。',
      }],
      usedIndex: true,
      route: 'coverage_below_threshold',
      indexMeta: {
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 2,
        coverage_ratio: 0.4,
      },
    });

    const registerTool = vi.fn();
    registerSearchMhlwTsutatsuTool(createServerStub(registerTool));
    const [, , handler] = registerTool.mock.calls[0];

    const result = await handler({ keyword: '足場' });

    expect(result.structuredContent.status).toBe('not_found');
    expect(result.structuredContent.degraded).toBe(true);
    expect(result.structuredContent.data?.route).toBe('coverage_below_threshold');
    expect(result.structuredContent.warnings[0]?.code).toBe('INDEX_COVERAGE_LOW');
  });

  it('search_jaish_tsutatsu は stale index 候補に index citation を付ける', async () => {
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [{
        title: '足場の安全基準について',
        number: '基安発0106第3号',
        date: '2026-01-06',
        url: '/anzen/example.htm',
      }],
      pagesSearched: 0,
      failedPages: [],
      warnings: [{
        code: 'STALE_INDEX_USED',
        message: '内部 index は stale ですが、既知候補のため index-only で返しました。',
      }],
      usedIndex: true,
      route: 'stale_but_usable',
      indexMeta: {
        source: 'jaish',
        generated_at: '2026-03-01T00:00:00.000Z',
        freshness: 'stale',
        entry_count: 1,
        coverage_ratio: 1,
      },
    });

    const registerTool = vi.fn();
    registerSearchJaishTsutatsuTool(createServerStub(registerTool));
    const [, , handler] = registerTool.mock.calls[0];

    const result = await handler({ keyword: '足場' });
    const candidate = result.structuredContent.data?.results[0];

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.degraded).toBe(true);
    expect(result.structuredContent.data?.route).toBe('stale_but_usable');
    expect(candidate?.citation_basis).toBe('index');
    expect(candidate?.indexed_at).toBe('2026-03-01T00:00:00.000Z');
    expect(candidate?.retrieved_at).toBeUndefined();
    expect(candidate?.citations[0]?.source_type).toBe('jaish');
  });
});
