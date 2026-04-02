import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getJaishTsutatsu } from '../lib/services/jaish-tsutatsu-service.js';

export function registerGetJaishTsutatsuTool(server: McpServer) {
  server.tool(
    'get_jaish_tsutatsu',
    '安全衛生情報センター（JAISH）の通達本文を取得する。search_jaish_tsutatsu で取得した url を指定。',
    {
      url: z.string().min(1).max(300).describe(
        '通達ページのURL（パスまたは完全URL）。search_jaish_tsutatsu の検索結果から取得。例: "/anzen/hor/hombun/hor1-67/hor1-67-1-1-0.htm"'
      ),
    },
    async (args) => {
      try {
        const result = await getJaishTsutatsu({ url: args.url });

        const title = result.title || '(タイトル取得不可)';

        return {
          content: [{
            type: 'text' as const,
            text: `# ${title}\n\n${result.body}\n\n---\n出典：安全衛生情報センター（中央労働災害防止協会）\nURL: ${result.url}`,
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
