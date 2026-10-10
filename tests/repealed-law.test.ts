import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const raw = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8');
// live の日本学術会議法（昭和23年法律第121号、2026-10-01 廃止）から第1条・第2条だけを切り出したもの
const fixtures: Record<string, string> = {
  '323AC0000000121': raw('repealed-gakujutsu.json'),
};

async function connect() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const id = String(url).split('/').at(-1)!;
    return new Response(fixtures[id] ?? '{}', { status: fixtures[id] ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  const { createServer } = await import('../src/server.js');
  return createServer();
}

describe('get_article: 廃止された法令', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('廃止時点の条文を、廃止日・廃止した法令とともに返す', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '323AC0000000121', article: '1' });
    expect(env.status).toBe('ok');
    expect(env.data.law_title).toBe('日本学術会議法');
    expect(env.data.version_info).toContain('廃止日 2026-10-01（令和8年10月1日）');
    expect(env.data.version_info).not.toContain('現行版の施行日');
    expect(env.data.revision_metadata).toMatchObject({
      repeal_status: 'Repeal',
      repeal_date: '2026-10-01',
      amendment_law_id: '507AC0000000070',
    });
    const [w] = env.warnings.filter((x: any) => x.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(w.message).toContain('日本学術会議法: この法令は廃止されています。');
    expect(w.message).toContain('廃止した法令は「日本学術会議法」（令和七年法律第七十号）です。');
  });
});
