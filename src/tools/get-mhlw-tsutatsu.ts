import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildMhlwCanonicalId } from '../lib/canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../lib/evidence-metadata.js';
import { getMhlwTsutatsu } from '../lib/services/mhlw-tsutatsu-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const getMhlwInputSchema = z.object({
  data_id: z.string().min(1).max(64).describe(
    '通達のdataId。search_mhlw_tsutatsu の検索結果から取得。例: "00tb2035"'
  ),
  page_no: z.number().int().min(1).max(999).optional().describe(
    'ページ番号（デフォルト1）。長い通達は複数ページに分かれている場合がある。'
  ),
});

const getMhlwOutputSchema = createToolEnvelopeSchema(
  z.object({
    source_type: z.literal('mhlw'),
    canonical_id: z.string(),
    title: z.string(),
    body: z.string(),
    data_id: z.string(),
    page_no: z.number(),
    source_url: z.string(),
    retrieved_at: z.string(),
    version_info: z.string().optional(),
    upstream_hash: z.string(),
  })
);

export function registerGetMhlwTsutatsuTool(server: McpServer) {
  server.registerTool(
    'get_mhlw_tsutatsu',
    {
      description: '厚生労働省の通達本文を取得する。search_mhlw_tsutatsu で取得した data_id を指定。',
      inputSchema: getMhlwInputSchema,
      outputSchema: getMhlwOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await getMhlwTsutatsu({
          dataId: args.data_id,
          pageNo: args.page_no,
        });

        const title = result.title || '(タイトル取得不可)';
        const pageNo = args.page_no ?? 1;
        const versionInfo = joinVersionInfo([result.date, result.number]);
        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: [],
          partial_failures: [],
          data: {
            source_type: 'mhlw' as const,
            canonical_id: buildMhlwCanonicalId(result.dataId, pageNo),
            title,
            body: result.body,
            data_id: result.dataId,
            page_no: pageNo,
            source_url: result.url,
            retrieved_at: isoNow(),
            version_info: versionInfo,
            upstream_hash: computeUpstreamHash([result.dataId, title, result.body, result.url]),
          },
        };

        return createToolResult(
          'get_mhlw_tsutatsu',
          envelope,
          `# ${title}\n\n${result.body}\n\n---\n出典：厚生労働省 法令等データベース\nURL: ${result.url}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'get_mhlw_tsutatsu',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
