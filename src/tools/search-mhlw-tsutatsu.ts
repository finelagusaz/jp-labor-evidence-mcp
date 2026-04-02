import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildMhlwDocumentCanonicalId } from '../lib/canonical-id.js';
import { searchMhlwTsutatsu } from '../lib/services/mhlw-tsutatsu-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const searchMhlwInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe(
    '検索キーワード。例: "36協定", "有給休暇", "労災認定", "社会保険適用拡大", "育児休業給付"'
  ),
  page: z.number().int().min(0).max(999).optional().describe(
    'ページ番号（0始まり、デフォルト0）。1ページあたり約20件。'
  ),
});

const searchMhlwOutputSchema = createToolEnvelopeSchema(
  z.object({
    keyword: z.string(),
    page: z.number(),
    total_count: z.number(),
    retrieved_at: z.string(),
    source_url: z.string(),
    results: z.array(z.object({
      title: z.string(),
      date: z.string(),
      shubetsu: z.string(),
      data_id: z.string(),
      canonical_id: z.string(),
    })),
  })
);

export function registerSearchMhlwTsutatsuTool(server: McpServer) {
  server.registerTool(
    'search_mhlw_tsutatsu',
    {
      description: '厚生労働省の法令等データベースから通達をキーワード検索する。労働基準、雇用保険、安全衛生、社会保険等の行政通達を検索可能。',
      inputSchema: searchMhlwInputSchema,
      outputSchema: searchMhlwOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await searchMhlwTsutatsu({
          keyword: args.keyword,
          page: args.page,
        });
        const page = result.page;
        const retrievedAt = isoNow();
        const sourceUrl = 'https://www.mhlw.go.jp/hourei/';
        const envelope = {
          status: result.status,
          error_code: result.status === 'unavailable' ? 'upstream_unavailable' as const : undefined,
          retryable: result.status === 'unavailable',
          degraded: result.status !== 'ok' || result.warnings.length > 0,
          warnings: result.warnings,
          partial_failures: result.partialFailures,
          data: {
            keyword: args.keyword,
            page,
            total_count: result.totalCount,
            retrieved_at: retrievedAt,
            source_url: sourceUrl,
            results: result.results.map((r) => ({
              title: r.title,
              date: r.date,
              shubetsu: r.shubetsu,
              data_id: r.dataId,
              canonical_id: buildMhlwDocumentCanonicalId(r.dataId),
            })),
          },
        };

        if (result.status === 'unavailable') {
          const failureLines = result.partialFailures.map((failure) =>
            `- ${failure.target}: ${failure.reason}`
          );

          return createToolResult(
            'search_mhlw_tsutatsu',
            envelope,
            `# 厚労省通達検索結果: 「${args.keyword}」\n\n状態: unavailable\n検索結果の取得に失敗しました。\n\n失敗箇所:\n${failureLines.join('\n')}`,
            startedAt,
          );
        }

        if (result.results.length === 0) {
          const warningSection = result.warnings.length > 0
            ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
            : '';
          return createToolResult(
            'search_mhlw_tsutatsu',
            {
              ...envelope,
              status: 'not_found' as const,
              error_code: 'not_found' as const,
              retryable: false,
            },
            `# 厚労省通達検索結果: 「${args.keyword}」\n\n状態: not_found\n0件（${result.page + 1}ページ目）\nキーワードを変えて再検索してください（例: 類義語・上位概念・正式名称を試す）。\n安全衛生関連の場合は search_jaish_tsutatsu も試してください。${warningSection}`,
            startedAt,
          );
        }

        const lines = result.results.map((r, i) => {
          const num = (result.page * 20) + i + 1;
          return `${num}. **${r.title}**\n   日付: ${r.date}\n   番号: ${r.shubetsu}\n   data_id: \`${r.dataId}\``;
        });
        const warningSection = result.warnings.length > 0
          ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';

        return createToolResult(
          'search_mhlw_tsutatsu',
          envelope,
          `# 厚労省通達検索結果: 「${args.keyword}」\n\n状態: ${result.status}\n該当件数: ${result.totalCount}件（${result.page + 1}ページ目）\n\n${lines.join('\n\n')}${warningSection}\n\n---\n※ 本文を読むには get_mhlw_tsutatsu で data_id を指定してください。\n出典：厚生労働省 法令等データベース`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'search_mhlw_tsutatsu',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
