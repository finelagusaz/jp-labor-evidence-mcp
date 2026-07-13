import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from '../src/lib/indexes/egov-index.js';
import { callTool } from './test-helpers/mcp-internals.js';

// --- (A) 挙動テスト: law-service を mock し handler を直呼び ---
vi.mock('../src/lib/services/law-service.js', () => ({
  searchLaw: vi.fn(),
  getLawArticle: vi.fn(),
  getLawToc: vi.fn(),
  resolveLaw: vi.fn(),
  getArticleByLawId: vi.fn(),
  findRelatedSources: vi.fn(),
}));

import { getArticleByLawId } from '../src/lib/services/law-service.js';
import { registerGetArticleTool } from '../src/tools/get-article.js';

function stubServer(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('get_article revision (挙動)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(getEgovIndexMeta().generated_at));
    vi.resetAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('現行版: revision_metadata と強化 version_info を返し警告なし', async () => {
    const registerTool = vi.fn();
    registerGetArticleTool(stubServer(registerTool));
    const [, , handler] = registerTool.mock.calls[0];
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049', lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号', promulgationDate: '1947-04-07',
      article: '32', articleCaption: '労働時間', text: '使用者は...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      revisionInfo: {
        law_revision_id: '322AC0000000049_20260624_508AC0000000046',
        amendment_enforcement_date: '2026-06-24',
        current_revision_status: 'CurrentEnforced', repeal_status: 'None',
      },
    });
    const result = await handler({ law_id: '322AC0000000049', article: '32' });
    expect(result.structuredContent.data.revision_metadata.current_enforcement_date).toBe('2026-06-24');
    expect(result.structuredContent.data.revision_metadata.version_pinned_url).toContain('/api/2/law_data/');
    expect(result.structuredContent.data.version_info).toContain('現行版の施行日 2026-06-24');
    expect(result.structuredContent.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(false);
  });

  it('廃止法令: LAW_NOT_CURRENTLY_ENFORCED を法令名接頭で返す', async () => {
    const registerTool = vi.fn();
    registerGetArticleTool(stubServer(registerTool));
    const [, , handler] = registerTool.mock.calls[0];
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '000AC0000000000', lawTitle: '旧・某法',
      lawNum: '某法律', promulgationDate: '1950-01-01',
      article: '1', articleCaption: '', text: '...',
      egovUrl: 'https://laws.e-gov.go.jp/law/000AC0000000000',
      revisionInfo: { repeal_status: 'Repeal', repeal_date: '2020-04-01' },
    });
    const result = await handler({ law_id: '000AC0000000000', article: '1' });
    const w = result.structuredContent.warnings.find((x: any) => x.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(w?.message).toContain('旧・某法: ');
    expect(w?.message).toContain('廃止されています');
  });
});

// --- (B) outputSchema 検証: callTool 経由（C1: null を弾かない） ---
const laborFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8'),
);

describe('get_article revision (outputSchema 検証)', () => {
  beforeEach(() => {
    // このファイル冒頭の vi.mock('../src/lib/services/law-service.js', ...) は
    // resetModules() 後の動的 import でも生き残るため、(B) では実装を使うために明示的に解除する。
    // vi.unmock はホイストされ (A) の mock も無効化してしまうため、非ホイストの vi.doUnmock を使う。
    vi.doUnmock('../src/lib/services/law-service.js');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(laborFixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('null を含む revision_info でも outputSchema validation を通過する', async () => {
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.data.revision_metadata.current_enforcement_date).toBe('2026-06-24');
    // null 由来フィールドは undefined 化され validation error を起こさない
    expect(env.data.revision_metadata.enforcement_note).toBeUndefined();
  }, 30000);
});
