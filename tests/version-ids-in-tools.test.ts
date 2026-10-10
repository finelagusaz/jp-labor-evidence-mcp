import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';
import { useTempIndexDir } from './test-helpers/temp-index-dir.js';

const raw = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8');
const PENDING = '322AC0000000049_20281223_508AC0000000046';
const PAST = '322AC0000000049_20250601_504AC0000000068';
// 労基則の附則つき fixture を、版の ID でも返す（版の ID の形式であればよい）
const ROKISO_VERSION = '322M40000100023_20270401_508M60000100057';
const fixtures: Record<string, string> = {
  '322AC0000000049': raw('diff-roki-20260717.json'),
  [PENDING]: raw('diff-roki-20281223.json'),
  [PAST]: raw('diff-roki-20250601.json'),
  '322M40000100023': raw('suppl-subitem-rokiso.json'),
  [ROKISO_VERSION]: raw('suppl-subitem-rokiso.json'),
};

async function connect() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const id = String(url).split('/').at(-1)!;
    return new Response(fixtures[id] ?? '{}', { status: fixtures[id] ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  const { createServer } = await import('../src/server.js');
  return createServer();
}

describe('get_article: 版の指定', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('未施行の版の ID を渡すと、その版の条文と版の情報を返す', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: PENDING, article: '58' });
    expect(env.status).toBe('ok');
    expect(env.data.body).toContain('未成年後見人');
    expect(env.data).toMatchObject({
      law_id: '322AC0000000049',
      law_revision_id: PENDING,
      canonical_id: `egov:${PENDING}:article:58`,
      source_url: 'https://laws.e-gov.go.jp/law/322AC0000000049/20281223_508AC0000000046',
    });
    expect(env.data.version_info).toContain('この版の施行予定日 2028-12-23（令和10年12月23日）');
    expect(env.data.revision_metadata.scheduled_enforcement_date).toBe('2028-12-23');
    const notCurrent = env.warnings.filter((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(notCurrent).toHaveLength(1);
    expect(notCurrent[0].message).toContain('この版はまだ施行されていません');
  });

  it('過去の版の ID: 「この版の施行日」と過去の施行版の警告', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: PAST, article: '32' });
    expect(env.status).toBe('ok');
    expect(env.data.version_info).toContain('この版の施行日 2025-06-01（令和7年6月1日）');
    expect(env.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED' && w.message.includes('過去の施行版'))).toBe(true);
  });

  it('law_id で指定したときは従来どおり（law_revision_id を返さない）', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '58' });
    expect(env.status).toBe('ok');
    expect(env.data.law_revision_id).toBeUndefined();
    expect(env.data.canonical_id).toBe('egov:322AC0000000049:article:58');
    expect(env.data.version_info).toContain('現行版の施行日');
  });
});

describe('list_suppl_provisions: 版の指定', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('版の ID を渡すと、その版の附則を版の ID つきで一覧する', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'list_suppl_provisions', { law_id: ROKISO_VERSION });
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      law_id: '322M40000100023',
      law_revision_id: ROKISO_VERSION,
      source_url: 'https://laws.e-gov.go.jp/law/322M40000100023/20270401_508M60000100057',
    });
    expect(env.data.items[0].canonical_id).toBe(`egov:${ROKISO_VERSION}:suppl:令和8年厚生労働省令第57号`);

    const picked = await callTool<any>(server, 'get_article', { law_id: ROKISO_VERSION, supplementary: env.data.items[2].key, paragraph: 1 });
    expect(picked.status).toBe('ok');
    expect(picked.data.canonical_id).toBe(`egov:${ROKISO_VERSION}:suppl:平成元年労働省令第1号:paragraph:1`);
  });

  it('law_id で指定したときは law_revision_id を返さない', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'list_suppl_provisions', { law_id: '322M40000100023' });
    expect(env.data.law_revision_id).toBeUndefined();
    expect(env.data.items[0].canonical_id).toBe('egov:322M40000100023:suppl:令和8年厚生労働省令第57号');
  });
});

describe('get_evidence_bundle: 版の指定', () => {
  useTempIndexDir();
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('主根拠をその版の条文にし、article_locator に版の ID を載せる', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_evidence_bundle', { law_id: PENDING, article: '58', include_jaish: false });
    const primary = env.data.primary_evidence;
    expect(primary.body).toContain('未成年後見人');
    expect(primary.canonical_id).toBe(`egov:${PENDING}:article:58`);
    expect(primary.source_url).toBe('https://laws.e-gov.go.jp/law/322AC0000000049/20281223_508AC0000000046');
    expect(primary.version_info).toContain('この版の施行予定日 2028-12-23');
    expect(primary.article_locator).toMatchObject({ law_id: '322AC0000000049', law_revision_id: PENDING, article: '58' });
  });
});
