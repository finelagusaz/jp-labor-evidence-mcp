import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLawArticle, getLawToc } from '../lib/services/law-service.js';

export function registerGetLawTool(server: McpServer) {
  server.tool(
    'get_law',
    '日本の法令から特定の条文を取得する。e-Gov法令API v2を使用。略称にも対応（労基法→労働基準法、安衛法→労働安全衛生法 等）。',
    {
      law_name: z.string().describe(
        '法令名または略称。例: "労働基準法", "労働安全衛生法", "雇用保険法", "健康保険法", "労基法", "安衛法", "派遣法", "育介法"'
      ),
      article: z.string().optional().describe(
        '条文番号（format="toc"の場合は省略可）。例: "32", "36", "32の2", "第36条"'
      ),
      paragraph: z.number().optional().describe(
        '項番号（省略時は条文全体）。例: 1, 2'
      ),
      item: z.number().optional().describe(
        '号番号（省略時は項全体）。例: 1, 2'
      ),
      format: z.enum(['markdown', 'toc']).optional().describe(
        '出力形式。"markdown"=条文全文（デフォルト）, "toc"=目次のみ（トークン節約）'
      ),
    },
    async (args) => {
      try {
        if (args.format === 'toc') {
          const result = await getLawToc({ lawName: args.law_name });
          return {
            content: [{
              type: 'text' as const,
              text: `# ${result.lawTitle} — 目次\n\n${result.toc}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
            }],
          };
        }

        if (!args.article) {
          return {
            content: [{
              type: 'text' as const,
              text: 'エラー: 条文番号（article）を指定してください。目次を取得する場合は format="toc" を指定してください。',
            }],
            isError: true,
          };
        }

        const result = await getLawArticle({
          lawName: args.law_name,
          article: args.article,
          paragraph: args.paragraph,
          item: args.item,
        });

        // 条文番号の表示を正規化（「第XX条」形式にする。入力が既に含む場合は二重付与しない）
        const rawArticle = args.article.replace(/_/g, 'の');
        const articleDisplay = /^第/.test(rawArticle) ? rawArticle : `第${rawArticle}条`;
        const paraDisplay = args.paragraph ? `第${args.paragraph}項` : '';
        const itemDisplay = args.item ? `第${args.item}号` : '';

        return {
          content: [{
            type: 'text' as const,
            text: `# ${result.lawTitle} ${articleDisplay}${paraDisplay}${itemDisplay}\n${result.articleCaption ? `（${result.articleCaption}）\n` : ''}\n${result.text}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
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
