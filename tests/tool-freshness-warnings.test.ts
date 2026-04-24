import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_AT_MS = Date.parse('2026-04-02T00:00:00.000Z');

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const internal = server.server as unknown as {
    _requestHandlers: Map<string, (req: any) => Promise<any>>;
  };
  const handler = internal._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  const result = await handler({
    method: 'tools/call',
    params: { name, arguments: args },
  } as any);
  return result.structuredContent as { warnings: Array<{ code: string; message: string }> };
}

describe('tool freshness warnings integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    indexMetadataRegistry.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('egov 消費 tool', () => {
    it('resolve_law: egov aged で BUNDLED_INDEX_AGED を含む', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 61 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(true);
    });

    it('resolve_law: egov fresh なら BUNDLED_INDEX_AGED を含まない', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 3 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(false);
    });
  });
});
