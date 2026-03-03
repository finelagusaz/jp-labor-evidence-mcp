import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getMhlwTsutatsu } from '../lib/services/mhlw-tsutatsu-service.js';

export function registerGetMhlwTsutatsuTool(server: McpServer) {
  server.tool(
    'get_mhlw_tsutatsu',
    '厚生労働省の通達本文を取得する。search_mhlw_tsutatsu で取得した data_id を指定。',
    {
      data_id: z.string().describe(
        '通達のdataId。search_mhlw_tsutatsu の検索結果から取得。例: "00tb2035"'
      ),
      page_no: z.number().optional().describe(
        'ページ番号（デフォルト1）。長い通達は複数ページに分かれている場合がある。'
      ),
    },
    async (args) => {
      try {
        const result = await getMhlwTsutatsu({
          dataId: args.data_id,
          pageNo: args.page_no,
        });

        const title = result.title || '(タイトル取得不可)';

        return {
          content: [{
            type: 'text' as const,
            text: `# ${title}\n\n${result.body}\n\n---\n出典：厚生労働省 法令等データベース\nURL: ${result.url}`,
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
