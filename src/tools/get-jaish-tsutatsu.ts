import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildJaishCanonicalId } from '../lib/canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../lib/evidence-metadata.js';
import { getJaishTsutatsu } from '../lib/services/jaish-tsutatsu-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const getJaishInputSchema = z.object({
  url: z.string().min(1).max(300).describe(
    '通達ページのURL（パスまたは完全URL）。search_jaish_tsutatsu の検索結果から取得。例: "/anzen/hor/hombun/hor1-67/hor1-67-1-1-0.htm"'
  ),
});

const getJaishOutputSchema = createToolEnvelopeSchema(
  z.object({
    source_type: z.literal('jaish'),
    canonical_id: z.string(),
    title: z.string(),
    body: z.string(),
    url: z.string(),
    source_url: z.string(),
    retrieved_at: z.string(),
    version_info: z.string().optional(),
    upstream_hash: z.string(),
  })
);

export function registerGetJaishTsutatsuTool(server: McpServer) {
  server.registerTool(
    'get_jaish_tsutatsu',
    {
      description: '安全衛生情報センター（JAISH）の通達本文を取得する。search_jaish_tsutatsu で取得した url を指定。',
      inputSchema: getJaishInputSchema,
      outputSchema: getJaishOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await getJaishTsutatsu({ url: args.url });

        const title = result.title || '(タイトル取得不可)';
        const versionInfo = joinVersionInfo([result.date, result.number]);
        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: [],
          partial_failures: [],
          data: {
            source_type: 'jaish' as const,
            canonical_id: buildJaishCanonicalId(result.url),
            title,
            body: result.body,
            url: result.url,
            source_url: result.url,
            retrieved_at: isoNow(),
            version_info: versionInfo,
            upstream_hash: computeUpstreamHash([result.url, title, result.body]),
          },
        };

        return createToolResult(
          'get_jaish_tsutatsu',
          envelope,
          `# ${title}\n\n${result.body}\n\n---\n出典：安全衛生情報センター（中央労働災害防止協会）\nURL: ${result.url}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'get_jaish_tsutatsu',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
