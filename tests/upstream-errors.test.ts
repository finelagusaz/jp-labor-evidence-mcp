import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const laborFixture = readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8');

/** law_id ごとに e-Gov の応答を決める fetch の stub */
async function connect(respond: (lawId: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => respond(String(url).split('/').at(-1)!)));
  const { createServer } = await import('../src/server.js');
  return createServer();
}
const ok = () => new Response(laborFixture, { status: 200, headers: { 'content-type': 'application/json' } });

describe('get_article: 上流の失敗の伝え方', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('存在しない law_id（HTTP 404）は not_found', async () => {
    const server = await connect(() => new Response('', { status: 404, statusText: 'Not Found' }));
    const env = await callTool<any>(server, 'get_article', { law_id: '999AC0000000999', article: '1' });
    expect(env).toMatchObject({ status: 'not_found', error_code: 'not_found', retryable: false });
  });

  it('e-Gov の一時的な障害（HTTP 503）は upstream_unavailable で再試行可', async () => {
    const server = await connect(() => new Response('', { status: 503, statusText: 'Service Unavailable' }));
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env).toMatchObject({ status: 'unavailable', error_code: 'upstream_unavailable', retryable: true });
  });

  it('存在しない law_id を続けて引いても、ほかの法令の取得は止まらない（サーキットが開かない）', async () => {
    const server = await connect((lawId) => (lawId === '322AC0000000049' ? ok() : new Response('', { status: 404, statusText: 'Not Found' })));
    for (const id of ['999AC0000000001', '999AC0000000002', '999AC0000000003', '999AC0000000004']) {
      await callTool<any>(server, 'get_article', { law_id: id, article: '1' });
    }
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
  });

  it('未施行改正の確認が 404 なら、degrade の reason は not_found', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).includes('/law_revisions/') ? new Response('', { status: 404, statusText: 'Not Found' }) : ok()));
    const { createServer } = await import('../src/server.js');
    const env = await callTool<any>(createServer(), 'get_article', { law_id: '322AC0000000049', article: '32', include_pending_amendments: true });
    expect(env.status).toBe('partial');
    expect(env.partial_failures).toEqual([{ source: 'egov', target: 'law_revisions:322AC0000000049', reason: 'not_found' }]);
  });
});
