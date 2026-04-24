import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovArticleCanonicalId } from '../lib/canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../lib/evidence-metadata.js';
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
import { getArticleByLawId } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const getArticleInputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    'resolve_law または search_law で確定した e-Gov law_id。例: "322AC0000000049"'
  ),
  article: z.string().min(1).max(20).describe(
    '条文番号。例: "32", "36", "32の2", "第36条"'
  ),
  paragraph: z.number().int().positive().max(99).optional().describe(
    '項番号（省略時は条文全体）。例: 1, 2'
  ),
  item: z.number().int().positive().max(999).optional().describe(
    '号番号（省略時は項全体）。例: 1, 2'
  ),
});

const getArticleOutputSchema = createToolEnvelopeSchema(
  z.object({
    source_type: z.literal('egov'),
    canonical_id: z.string(),
    law_id: z.string(),
    law_title: z.string(),
    article: z.string(),
    paragraph: z.number().optional(),
    item: z.number().optional(),
    title: z.string(),
    body: z.string(),
    source_url: z.string(),
    retrieved_at: z.string(),
    version_info: z.string().optional(),
    upstream_hash: z.string(),
  })
);

export function registerGetArticleTool(server: McpServer) {
  server.registerTool(
    'get_article',
    {
      description: '確定済み law_id に対して、特定条文を厳密に取得する。resolve_law の後段で使用する。',
      inputSchema: getArticleInputSchema,
      outputSchema: getArticleOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await getArticleByLawId({
          lawId: args.law_id,
          article: args.article,
          paragraph: args.paragraph,
          item: args.item,
        });

        const rawArticle = args.article.replace(/_/g, 'の');
        const articleDisplay = /^第/.test(rawArticle) ? rawArticle : `第${rawArticle}条`;
        const paraDisplay = args.paragraph ? `第${args.paragraph}項` : '';
        const itemDisplay = args.item ? `第${args.item}号` : '';
        const title = `${result.lawTitle} ${articleDisplay}${paraDisplay}${itemDisplay}`;
        const body = `${result.articleCaption ? `（${result.articleCaption}）\n` : ''}${result.text}`;
        const versionInfo = joinVersionInfo([result.lawNum, result.promulgationDate]);
        const freshnessWarnings = getIndexWarningsForTool(['egov']).map(({ code, message }) => ({ code, message }));

        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: freshnessWarnings,
          partial_failures: [],
          data: {
            source_type: 'egov' as const,
            canonical_id: buildEgovArticleCanonicalId(result.lawId, args.article, args.paragraph, args.item),
            law_id: result.lawId,
            law_title: result.lawTitle,
            article: args.article,
            paragraph: args.paragraph,
            item: args.item,
            title,
            body,
            source_url: result.egovUrl,
            retrieved_at: isoNow(),
            version_info: versionInfo,
            upstream_hash: computeUpstreamHash([result.lawId, title, body, result.egovUrl]),
          },
        };

        return createToolResult(
          'get_article',
          envelope,
          `# ${title}\n${result.articleCaption ? `（${result.articleCaption}）\n` : ''}\n${result.text}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'get_article',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
