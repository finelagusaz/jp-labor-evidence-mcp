import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/lib/services/law-service.js', () => ({
  searchLaw: vi.fn(),
  getLawArticle: vi.fn(),
  getLawToc: vi.fn(),
  resolveLaw: vi.fn(),
  getArticleByLawId: vi.fn(),
}));

import { searchLaw, resolveLaw, getArticleByLawId } from '../src/lib/services/law-service.js';
import { registerSearchLawTool } from '../src/tools/search-law.js';
import { registerResolveLawTool } from '../src/tools/resolve-law.js';
import { registerGetArticleTool } from '../src/tools/get-article.js';

type RegisterToolMock = ReturnType<typeof vi.fn>;

function createServerStub(registerTool: RegisterToolMock): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('tool wire contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('search_law は outputSchema と structuredContent を返す', async () => {
    const registerTool = vi.fn();
    registerSearchLawTool(createServerStub(registerTool));

    const [, config, handler] = registerTool.mock.calls[0];
    expect(config.outputSchema).toBeDefined();

    vi.mocked(searchLaw).mockResolvedValue({
      keyword: '労働基準',
      results: [{
        lawTitle: '労働基準法',
        lawId: '322AC0000000049',
        lawNum: '昭和二十二年法律第四十九号',
        lawType: 'Act',
        egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      }],
    });

    const result = await handler({ keyword: '労働基準' });

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.data?.results[0]?.canonical_id).toBe('322AC0000000049');
    expect(result.content[0]?.type).toBe('text');
  });

  it('search_law は 0 件時に not_found を返す', async () => {
    const registerTool = vi.fn();
    registerSearchLawTool(createServerStub(registerTool));

    const [, , handler] = registerTool.mock.calls[0];
    vi.mocked(searchLaw).mockResolvedValue({
      keyword: '存在しない',
      results: [],
    });

    const result = await handler({ keyword: '存在しない' });

    expect(result.structuredContent.status).toBe('not_found');
    expect(result.isError).toBe(false);
  });

  it('resolve_law は ambiguous を partial として返す', async () => {
    const registerTool = vi.fn();
    registerResolveLawTool(createServerStub(registerTool));

    const [, config, handler] = registerTool.mock.calls[0];
    expect(config.outputSchema).toBeDefined();

    vi.mocked(resolveLaw).mockReturnValue({
      query: '労働',
      resolution: 'ambiguous',
      candidates: [
        {
          lawId: '322AC0000000049',
          lawTitle: '労働基準法',
          lawType: 'Act',
          sourceUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
          aliases: ['労基法'],
        },
        {
          lawId: '324AC0000000174',
          lawTitle: '労働組合法',
          lawType: 'Act',
          sourceUrl: 'https://laws.e-gov.go.jp/law/324AC0000000174',
          aliases: ['労組法'],
        },
      ],
    });

    const result = await handler({ query: '労働' });

    expect(result.structuredContent.status).toBe('partial');
    expect(result.structuredContent.data?.resolution).toBe('ambiguous');
    expect(result.isError).toBe(false);
  });

  it('get_article は law_id 指定で本文を返す', async () => {
    const registerTool = vi.fn();
    registerGetArticleTool(createServerStub(registerTool));

    const [, config, handler] = registerTool.mock.calls[0];
    expect(config.outputSchema).toBeDefined();

    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      article: '32',
      articleCaption: '労働時間',
      text: '使用者は、労働者に...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
    });

    const result = await handler({ law_id: '322AC0000000049', article: '32' });

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.data?.law_id).toBe('322AC0000000049');
    expect(result.structuredContent.data?.source_type).toBe('egov');
  });
});
