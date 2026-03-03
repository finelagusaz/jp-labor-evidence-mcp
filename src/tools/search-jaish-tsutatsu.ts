import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchJaishTsutatsu } from '../lib/services/jaish-tsutatsu-service.js';

export function registerSearchJaishTsutatsuTool(server: McpServer) {
  server.tool(
    'search_jaish_tsutatsu',
    '安全衛生情報センター（JAISH）から安全衛生関連の通達をキーワード検索する。労働安全衛生法、じん肺法、作業環境測定法等に関する通達を検索可能。',
    {
      keyword: z.string().describe(
        '検索キーワード。例: "特定化学物質", "有機溶剤", "安全教育", "健康診断", "石綿", "足場"'
      ),
      limit: z.number().optional().describe(
        '最大取得件数（デフォルト10、最大30）'
      ),
      max_pages: z.number().optional().describe(
        '検索する年度数（デフォルト5）。増やすと古い通達も検索するが時間がかかる。'
      ),
    },
    async (args) => {
      try {
        const result = await searchJaishTsutatsu({
          keyword: args.keyword,
          limit: args.limit,
          maxPages: args.max_pages,
        });

        if (result.results.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `「${args.keyword}」に一致する安衛通達が見つかりませんでした（${result.pagesSearched}年度分を検索）。\nmax_pages を増やすと検索範囲が広がります。キーワードを変えて再検索も試してください。\n厚労省通達は search_mhlw_tsutatsu で検索できます。`,
            }],
          };
        }

        const lines = result.results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   日付: ${r.date}\n   番号: ${r.number}\n   url: \`${r.url}\``
        );

        return {
          content: [{
            type: 'text' as const,
            text: `# JAISH安衛通達検索結果: 「${args.keyword}」\n\n${result.results.length}件（${result.pagesSearched}年度分を検索）\n\n${lines.join('\n\n')}\n\n---\n※ 本文を読むには get_jaish_tsutatsu で url を指定してください。\n出典：安全衛生情報センター（中央労働災害防止協会）`,
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
