import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchMhlwTsutatsu } from '../lib/services/mhlw-tsutatsu-service.js';

export function registerSearchMhlwTsutatsuTool(server: McpServer) {
  server.tool(
    'search_mhlw_tsutatsu',
    '厚生労働省の法令等データベースから通達をキーワード検索する。労働基準、雇用保険、安全衛生、社会保険等の行政通達を検索可能。',
    {
      keyword: z.string().describe(
        '検索キーワード。例: "36協定", "有給休暇", "労災認定", "社会保険適用拡大", "育児休業給付"'
      ),
      page: z.number().optional().describe(
        'ページ番号（0始まり、デフォルト0）。1ページあたり約20件。'
      ),
    },
    async (args) => {
      try {
        const result = await searchMhlwTsutatsu({
          keyword: args.keyword,
          page: args.page,
        });

        if (result.results.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `「${args.keyword}」に一致する通達が見つかりませんでした。\nキーワードを変えて再検索してください（例: 類義語・上位概念・正式名称を試す）。\n安全衛生関連の場合は search_jaish_tsutatsu も試してください。`,
            }],
          };
        }

        const lines = result.results.map((r, i) => {
          const num = (result.page * 20) + i + 1;
          return `${num}. **${r.title}**\n   日付: ${r.date}\n   番号: ${r.shubetsu}\n   data_id: \`${r.dataId}\``;
        });

        return {
          content: [{
            type: 'text' as const,
            text: `# 厚労省通達検索結果: 「${args.keyword}」\n\n該当件数: ${result.totalCount}件（${result.page + 1}ページ目）\n\n${lines.join('\n\n')}\n\n---\n※ 本文を読むには get_mhlw_tsutatsu で data_id を指定してください。\n出典：厚生労働省 法令等データベース`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `エラー: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
