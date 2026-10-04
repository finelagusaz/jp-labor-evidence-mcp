import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/server.js';

// src/index.ts と同じ serveStdio(() => createServer()) を InMemoryTransport 越しに起動し、
// 生の JSON-RPC で両世代の opening を検証する（Client は 2025 系しか話さないため使わない）。

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'modern-protocol-test', version: '0.0.0' },
};

type Response = { id: number; result?: any; error?: { code: number; message: string } };

let handle: { close(): Promise<void> } | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

async function openConnection() {
  const [peer, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (res: Response) => void>();
  peer.onmessage = (message) => {
    const res = message as unknown as Response;
    pending.get(res.id)?.(res);
  };
  await peer.start();
  handle = serveStdio(() => createServer(), { transport });

  let nextId = 1;
  return (method: string, params: Record<string, unknown>): Promise<Response> => {
    const id = nextId++;
    const response = new Promise<Response>((resolve) => pending.set(id, resolve));
    void peer.send({ jsonrpc: '2.0', id, method, params } as any);
    return response;
  };
}

describe('MCP 2026-07-28 (serveStdio)', () => {
  it('server/discover が 2026-07-28・instructions・serverInfo を返す', async () => {
    const request = await openConnection();
    const res = await request('server/discover', { _meta: MODERN_META });

    expect(res.error).toBeUndefined();
    expect(res.result.supportedVersions).toContain('2026-07-28');
    expect(res.result.instructions).toContain('BUNDLED_INDEX_AGED');
    expect(res.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('jp-labor-evidence-mcp');
    expect(res.result.resultType).toBe('complete');
  });

  it('tools/list と prompts/list が全件を cache 情報付きで返す', async () => {
    const request = await openConnection();
    await request('server/discover', { _meta: MODERN_META });

    const tools = await request('tools/list', { _meta: MODERN_META });
    expect(tools.error).toBeUndefined();
    expect(tools.result.tools).toHaveLength(12);
    expect(tools.result.ttlMs).toEqual(expect.any(Number));
    expect(tools.result.cacheScope).toEqual(expect.any(String));

    const prompts = await request('prompts/list', { _meta: MODERN_META });
    expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toEqual([
      'labor_law_research',
      'tsutatsu_research',
      'safety_health_research',
    ]);
  });

  it('_meta の無い initialize は 2025 系として従来どおり応答する', async () => {
    const request = await openConnection();
    const res = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy-test', version: '0.0.0' },
    });

    expect(res.error).toBeUndefined();
    expect(res.result.protocolVersion).toBe('2025-11-25');
    expect(res.result.instructions).toContain('BUNDLED_INDEX_AGED');
  });
});
