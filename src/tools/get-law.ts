import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovArticleCanonicalId, buildEgovTocCanonicalId } from '../lib/canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../lib/evidence-metadata.js';
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
import { getLawArticle, getLawToc } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const getLawInputSchema = z.object({
  law_name: z.string().min(1).max(200).describe(
    '法令名または略称。例: "労働基準法", "労働安全衛生法", "雇用保険法", "健康保険法", "労基法", "安衛法", "派遣法", "育介法"'
  ),
  article: z.string().min(1).max(20).optional().describe(
    '条文番号（format="toc"の場合は省略可）。例: "32", "36", "32の2", "第36条"'
  ),
  paragraph: z.number().int().positive().max(99).optional().describe(
    '項番号（省略時は条文全体）。例: 1, 2'
  ),
  item: z.number().int().positive().max(999).optional().describe(
    '号番号（省略時は項全体）。例: 1, 2'
  ),
  format: z.enum(['markdown', 'toc']).optional().describe(
    '出力形式。"markdown"=条文全文（デフォルト）, "toc"=目次のみ（トークン節約）'
  ),
});

const getLawOutputSchema = createToolEnvelopeSchema(
  z.object({
    source_type: z.literal('egov'),
    canonical_id: z.string(),
    law_title: z.string(),
    law_name: z.string(),
    article: z.string().optional(),
    paragraph: z.number().optional(),
    item: z.number().optional(),
    format: z.enum(['markdown', 'toc']),
    title: z.string(),
    body: z.string(),
    source_url: z.string(),
    retrieved_at: z.string(),
    version_info: z.string().optional(),
    upstream_hash: z.string(),
  })
);

export function registerGetLawTool(server: McpServer) {
  server.registerTool(
    'get_law',
    {
      description: '非推奨。日本の法令から特定の条文を取得する旧ツール。新規利用では resolve_law と get_article を使用すること。',
      inputSchema: getLawInputSchema,
      outputSchema: getLawOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const deprecationWarning = {
          code: 'DEPRECATED_TOOL',
          message: 'get_law は非推奨です。新規利用では resolve_law と get_article を使用してください。',
        };
        const freshnessWarnings = getIndexWarningsForTool(['egov']).map(({ code, message }) => ({ code, message }));
        if (args.format === 'toc') {
          const result = await getLawToc({ lawName: args.law_name });
          const lawId = result.egovUrl.split('/').pop() ?? args.law_name;
          const envelope = {
            status: 'ok' as const,
            retryable: false,
            degraded: false,
            warnings: [...freshnessWarnings, deprecationWarning],
            partial_failures: [],
            data: {
              source_type: 'egov' as const,
              canonical_id: buildEgovTocCanonicalId(lawId),
              law_title: result.lawTitle,
              law_name: args.law_name,
              format: 'toc' as const,
              title: `${result.lawTitle} — 目次`,
              body: result.toc,
              source_url: result.egovUrl,
              retrieved_at: isoNow(),
              version_info: joinVersionInfo([result.lawNum, result.promulgationDate]),
              upstream_hash: computeUpstreamHash([lawId, result.lawTitle, result.toc, result.egovUrl]),
            },
          };
          return createToolResult(
            'get_law',
            envelope,
            `# ${result.lawTitle} — 目次\n\n${result.toc}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
            startedAt,
          );
        }

        if (!args.article) {
          return createToolResult(
            'get_law',
            {
              status: 'invalid',
              error_code: 'validation',
              retryable: false,
              degraded: false,
              warnings: [deprecationWarning],
              partial_failures: [],
              data: null,
            },
            'エラー: 条文番号（article）を指定してください。目次を取得する場合は format="toc" を指定してください。',
            startedAt,
          );
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
        const title = `${result.lawTitle} ${articleDisplay}${paraDisplay}${itemDisplay}`;
        const body = `${result.articleCaption ? `（${result.articleCaption}）\n` : ''}${result.text}`;
        const versionInfo = joinVersionInfo([result.lawNum, result.promulgationDate]);
        const lawId = result.egovUrl.split('/').pop() ?? args.law_name;
        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: [...freshnessWarnings, deprecationWarning],
          partial_failures: [],
          data: {
            source_type: 'egov' as const,
            canonical_id: buildEgovArticleCanonicalId(lawId, args.article, args.paragraph, args.item),
            law_title: result.lawTitle,
            law_name: args.law_name,
            article: args.article,
            paragraph: args.paragraph,
            item: args.item,
            format: 'markdown' as const,
            title,
            body,
            source_url: result.egovUrl,
            retrieved_at: isoNow(),
            version_info: versionInfo,
            upstream_hash: computeUpstreamHash([lawId, title, body, result.egovUrl]),
          },
        };

        return createToolResult(
          'get_law',
          envelope,
          `# ${title}\n${result.articleCaption ? `（${result.articleCaption}）\n` : ''}\n${result.text}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'get_law',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
