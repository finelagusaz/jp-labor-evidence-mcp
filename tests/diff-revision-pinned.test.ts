import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const raw = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8');
// live の労基法の 3 つの版から第32条・第58条だけを切り出したもの
const fixtures: Record<string, string> = {
  '322AC0000000049': raw('diff-roki-20260717.json'),
  '322AC0000000049_20260717_508AC0000000060': raw('diff-roki-20260717.json'),
  '322AC0000000049_20250601_504AC0000000068': raw('diff-roki-20250601.json'),
  '322AC0000000049_20281223_508AC0000000046': raw('diff-roki-20281223.json'),
};

async function connect() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const id = String(url).split('/').at(-1)!;
    return new Response(fixtures[id] ?? '{}', { status: fixtures[id] ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  const { createServer } = await import('../src/server.js');
  return createServer();
}

describe('diff_revision: 版の指定', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('現行版と未施行の版を比べ、各側に版の情報を載せる', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'diff_revision', {
      base_law_id: '322AC0000000049',
      head_law_id: '322AC0000000049_20281223_508AC0000000046',
      article: '58',
    });
    expect(env.status).toBe('ok');
    const { base_evidence: base, head_evidence: head } = env.data;

    expect(env.data.summary.changed).toBe(true);
    expect(env.data.diff_chunks.some((c: any) => c.type === 'insert' && c.text.includes('未成年後見人'))).toBe(true);

    expect(base.law_revision_id).toBeUndefined();
    expect(base.canonical_id).toBe('egov:322AC0000000049:article:58');
    expect(base.version_info).toContain('現行版の施行日 2026-07-17（令和8年7月17日）');
    expect(base.revision_metadata.current_revision_status).toBe('CurrentEnforced');

    expect(head.law_id).toBe('322AC0000000049');
    expect(head.law_revision_id).toBe('322AC0000000049_20281223_508AC0000000046');
    expect(head.canonical_id).toBe('egov:322AC0000000049_20281223_508AC0000000046:article:58');
    expect(head.source_url).toBe('https://laws.e-gov.go.jp/law/322AC0000000049/20281223_508AC0000000046');
    expect(head.version_info).toContain('この版の施行予定日 2028-12-23（令和10年12月23日）');
    expect(head.revision_metadata).toMatchObject({
      current_revision_status: 'UnEnforced',
      scheduled_enforcement_date: '2028-12-23',
      law_revision_id: '322AC0000000049_20281223_508AC0000000046',
    });

    const notCurrent = env.warnings.filter((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(notCurrent).toHaveLength(1);
    expect(notCurrent[0].message).toMatch(/^比較先: 労働基準法: この版はまだ施行されていません/);
  });

  it('過去の版と現行版: 過去の版の側だけ「比較元」として警告する', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'diff_revision', {
      base_law_id: '322AC0000000049_20250601_504AC0000000068',
      head_law_id: '322AC0000000049',
      article: '32',
    });
    expect(env.status).toBe('ok');
    expect(env.data.summary.changed).toBe(false);
    expect(env.data.base_evidence.version_info).toContain('この版の施行日 2025-06-01（令和7年6月1日）');
    expect(env.data.base_evidence.source_url).toBe('https://laws.e-gov.go.jp/law/322AC0000000049/20250601_504AC0000000068');
    const notCurrent = env.warnings.filter((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(notCurrent).toHaveLength(1);
    expect(notCurrent[0].message).toMatch(/^比較元: 労働基準法: この版は過去の施行版/);
  });

  it('version_pinned_url の版の ID は 20 文字を超えても受け付ける', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'diff_revision', {
      base_law_id: '322AC0000000049_20260717_508AC0000000060',
      head_law_id: '322AC0000000049_20281223_508AC0000000046',
      article: '32',
    });
    expect(env.status).toBe('ok');
    expect(env.data.base_evidence.version_info).toContain('この版の施行日 2026-07-17');
  });
});
