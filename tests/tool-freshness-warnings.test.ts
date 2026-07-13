import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';
import { callTool } from './test-helpers/mcp-internals.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_AT_MS = Date.parse('2026-07-13T00:00:00.000Z');

type WarningsEnvelope = { warnings: Array<{ code: string; message: string }> };

describe('tool freshness warnings integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    indexMetadataRegistry.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('mhlw / jaish 消費 tool', () => {
    it('search_mhlw_tsutatsu: mhlw stale で RUNTIME_INDEX_STALE を含む', async () => {
      const { createServer } = await import('../src/server.js');
      const { indexMetadataRegistry: registry } = await import('../src/lib/indexes/index-metadata.js');
      registry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const server = createServer();
      vi.useRealTimers();
      const envelope = await callTool<WarningsEnvelope>(server, 'search_mhlw_tsutatsu', { keyword: '36協定' });
      expect(envelope.warnings.some((w) => w.code === 'RUNTIME_INDEX_STALE' && w.message.includes('厚生労働省通達'))).toBe(true);
    }, 30000);

    it('search_jaish_tsutatsu: jaish stale で RUNTIME_INDEX_STALE を含む', async () => {
      const { createServer } = await import('../src/server.js');
      const { indexMetadataRegistry: registry } = await import('../src/lib/indexes/index-metadata.js');
      registry.register({
        source: 'jaish',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const server = createServer();
      vi.useRealTimers();
      const envelope = await callTool<WarningsEnvelope>(server, 'search_jaish_tsutatsu', { keyword: '労災' });
      expect(envelope.warnings.some((w) => w.code === 'RUNTIME_INDEX_STALE' && w.message.includes('JAISH'))).toBe(true);
    }, 30000);
  });

  describe('egov 消費 tool', () => {
    it('resolve_law: egov aged で BUNDLED_INDEX_AGED を含む', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 61 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool<WarningsEnvelope>(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(true);
    });

    it('resolve_law: egov fresh なら BUNDLED_INDEX_AGED を含まない', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 3 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool<WarningsEnvelope>(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(false);
    });
  });

  describe('multi-source tool', () => {
    it('find_related_sources: egov aged + mhlw stale + jaish stale で 3 件の warning', async () => {
      const { indexMetadataRegistry } = await import('../src/lib/indexes/index-metadata.js');
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
      vi.setSystemTime(new Date(GENERATED_AT_MS + 61 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool<WarningsEnvelope>(server, 'find_related_sources', {
        law_id: '322AC0000000049',
        article: '36',
      });
      const codes = envelope.warnings.map((w) => w.code);
      expect(codes).toContain('BUNDLED_INDEX_AGED');
      expect(codes.filter((c) => c === 'RUNTIME_INDEX_STALE').length).toBe(2);
    });
  });
});
