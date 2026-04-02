import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/lib/services/law-service.js', () => ({
  findRelatedSources: vi.fn(),
}));

import { findRelatedSources } from '../src/lib/services/law-service.js';
import { registerFindRelatedSourcesTool } from '../src/tools/find-related-sources.js';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('find_related_sources tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('structuredContent で委任先候補を返す', async () => {
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      delegatedLaws: [{
        lawId: '322CO0000000300',
        lawTitle: '労働基準法施行令',
        lawType: 'CabinetOrder',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322CO0000000300',
        aliases: ['労基令'],
      }],
      searchKeywords: ['労働時間'],
      warnings: [],
    });

    const registerTool = vi.fn();
    registerFindRelatedSourcesTool(createServerStub(registerTool));
    const [, config, handler] = registerTool.mock.calls[0];

    expect(config.outputSchema).toBeDefined();

    const result = await handler({ law_id: '322AC0000000049', article: '32' });

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.data?.delegated_laws[0]?.canonical_id).toBe('egov:322CO0000000300');
  });
});
