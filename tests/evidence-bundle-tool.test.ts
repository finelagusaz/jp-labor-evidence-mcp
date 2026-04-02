import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/lib/services/evidence-bundle-service.js', () => ({
  getEvidenceBundle: vi.fn(),
}));

import { getEvidenceBundle } from '../src/lib/services/evidence-bundle-service.js';
import { registerGetEvidenceBundleTool } from '../src/tools/get-evidence-bundle.js';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('get_evidence_bundle tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('structuredContent で bundle を返す', async () => {
    vi.mocked(getEvidenceBundle).mockResolvedValue({
      status: 'partial',
      primary_evidence: {
        source_type: 'egov',
        canonical_id: 'egov:322AC0000000049:article:32',
        title: '労働基準法 第32条',
        body: '使用者は...',
        source_url: 'https://laws.e-gov.go.jp/law/322AC0000000049',
        retrieved_at: '2026-04-02T10:00:00.000Z',
        warnings: [],
        version_info: '昭和二十二年法律第四十九号 / 1947-04-07',
        upstream_hash: 'a'.repeat(64),
        article_locator: {
          law_id: '322AC0000000049',
          article: '32',
        },
      },
      delegated_evidence: [],
      related_tsutatsu: [],
      warnings: [{ code: 'DELEGATED_EVIDENCE_NOT_IMPLEMENTED', message: '未実装' }],
      partial_failures: [{ source: 'mhlw', target: 'page:0', reason: 'timeout' }],
      search_keywords: ['労働時間'],
    });

    const registerTool = vi.fn();
    registerGetEvidenceBundleTool(createServerStub(registerTool));
    const [, config, handler] = registerTool.mock.calls[0];

    expect(config.outputSchema).toBeDefined();

    const result = await handler({ law_id: '322AC0000000049', article: '32' });

    expect(result.structuredContent.status).toBe('partial');
    expect(result.structuredContent.data?.primary_evidence.canonical_id).toBe('egov:322AC0000000049:article:32');
    expect(result.structuredContent.data?.partial_failures[0]?.source).toBe('mhlw');
  });
});
