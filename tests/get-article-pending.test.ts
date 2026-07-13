import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const laborFixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8'));
const aneiRevisions = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/law-revisions-anei.json', import.meta.url)), 'utf8'));

function stubFetch(revisionsResponder: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/law_revisions/')) return revisionsResponder(u);
    return new Response(JSON.stringify(laborFixture), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

describe('get_article pending amendments', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('省略時: /law_revisions を引かず pending_amendments は undefined・status ok', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.data.pending_amendments).toBeUndefined();
    expect((fetch as any).mock.calls.every((c: any[]) => !String(c[0]).includes('/law_revisions/'))).toBe(true);
  });

  it('true: pending_amendments（昇順3件）＋UNENFORCED_AMENDMENT_PENDING（hedge）・text に未施行節なし', async () => {
    stubFetch(() => new Response(JSON.stringify(aneiRevisions), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32', include_pending_amendments: true });
    expect(env.status).toBe('ok');
    expect(env.data.pending_amendments).toHaveLength(3);
    expect(env.data.pending_amendments[0].enforcement_date).toBe('2027-04-01');
    const w = env.warnings.find((x: any) => x.code === 'UNENFORCED_AMENDMENT_PENDING');
    expect(w.message).toContain('引用した条文が改正対象に含まれるとは限りません');
  });

  it('degrade: /law_revisions 失敗でも条文は返り status partial＋PENDING_AMENDMENT_CHECK_FAILED', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32', include_pending_amendments: true });
    expect(env.status).toBe('partial');
    expect(env.degraded).toBe(true);
    expect(env.data).not.toBeNull();
    expect(env.data.body).toBeTruthy(); // 条文は返る
    expect(env.data.pending_amendments).toBeUndefined();
    expect(env.partial_failures.some((f: any) => f.target.includes('law_revisions'))).toBe(true);
    expect(env.warnings.some((x: any) => x.code === 'PENDING_AMENDMENT_CHECK_FAILED')).toBe(true);
  });
});
