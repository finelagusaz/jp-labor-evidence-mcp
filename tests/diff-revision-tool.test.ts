import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../src/lib/services/diff-revision-service.js', () => ({
  diffRevision: vi.fn(),
}));

import { diffRevision } from '../src/lib/services/diff-revision-service.js';
import { registerDiffRevisionTool } from '../src/tools/diff-revision.js';

function createServerStub(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('diff_revision tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('structuredContent で差分を返す', async () => {
    vi.mocked(diffRevision).mockResolvedValue({
      status: 'ok',
      base_evidence: {
        source_type: 'egov',
        canonical_id: 'egov:base-law:article:32',
        law_id: 'base-law',
        law_title: '労働基準法',
        article: '32',
        title: '労働基準法 第32条',
        body: '使用者は...',
        source_url: 'https://laws.e-gov.go.jp/law/base-law',
        retrieved_at: '2026-04-02T10:00:00.000Z',
        version_info: '昭和二十二年法律第四十九号 / 1947-04-07',
        upstream_hash: 'a'.repeat(64),
      },
      head_evidence: {
        source_type: 'egov',
        canonical_id: 'egov:head-law:article:32',
        law_id: 'head-law',
        law_title: '労働基準法',
        article: '32',
        title: '労働基準法 第32条',
        body: '使用者は、労働者に...',
        source_url: 'https://laws.e-gov.go.jp/law/head-law',
        retrieved_at: '2026-04-02T10:00:00.000Z',
        version_info: '令和六年法律第十号 / 2024-04-01',
        upstream_hash: 'b'.repeat(64),
      },
      summary: {
        changed: true,
        inserted_chunks: 1,
        deleted_chunks: 1,
        unchanged_chunks: 1,
      },
      diff_chunks: [
        { type: 'equal', text: '（労働時間）' },
        { type: 'delete', text: '使用者は...' },
        { type: 'insert', text: '使用者は、労働者に...' },
      ],
      warnings: [],
    });

    const registerTool = vi.fn();
    registerDiffRevisionTool(createServerStub(registerTool));
    const [, config, handler] = registerTool.mock.calls[0];

    expect(config.outputSchema).toBeDefined();

    const result = await handler({
      base_law_id: 'base-law',
      head_law_id: 'head-law',
      article: '32',
    });

    expect(result.structuredContent.status).toBe('ok');
    expect(result.structuredContent.data?.summary.changed).toBe(true);
    expect(result.structuredContent.data?.diff_chunks[1]?.type).toBe('delete');
  });
});
