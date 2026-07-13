import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovArticleCanonicalId } from '../lib/canonical-id.js';
import { computeUpstreamHash, buildRevisionMetadata, buildVersionInfoString, getRevisionWarnings, getPendingAmendmentWarnings } from '../lib/evidence-metadata.js';
import { getIndexWarningsForTool, toWireWarnings } from '../lib/indexes/freshness-warnings.js';
import { getArticleByLawId, getPendingAmendments } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope, revisionMetadataSchema, pendingAmendmentSchema } from '../lib/tool-contract.js';
import { observabilityRegistry } from '../lib/observability.js';
import type { PendingAmendment } from '../lib/types.js';

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
  include_pending_amendments: z.boolean().optional().describe(
    '未施行の改正（施行予定日つき）を検知して pending_amendments に載せる。別途 e-Gov /law_revisions を1回追引きするため既定 false。' +
    'false／省略時は未施行改正の有無を確認しない（「改正予定なし」を意味しない）。就業規則改定・compliance 監査で改正リスクを確認する場面で true を指定。'
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
    revision_metadata: revisionMetadataSchema.optional(),
    pending_amendments: z.array(pendingAmendmentSchema).optional(),
    upstream_hash: z.string(),
  })
);

export function registerGetArticleTool(server: McpServer) {
  server.registerTool(
    'get_article',
    {
      description: '確定済み law_id に対して、特定条文を厳密に取得する。resolve_law の後段で使用する。未施行の改正確認は既定で行わない（include_pending_amendments: true 指定時のみ）。',
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
        const versionInfo = buildVersionInfoString(result.lawNum, result.promulgationDate, result.revisionInfo);
        const revisionMetadata = buildRevisionMetadata(result.revisionInfo);
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
        const warnings = [...freshnessWarnings, ...getRevisionWarnings(result.revisionInfo, result.lawTitle)];
        const partialFailures: Array<{ source: string; target: string; reason: string }> = [];
        let degraded = false;
        let pendingAmendments: PendingAmendment[] | undefined;

        // pending 取得は条文取得とは別の inner try/catch（失敗が条文成功を巻き添えない）
        if (args.include_pending_amendments === true) {
          try {
            const built = await getPendingAmendments(result.lawId);
            pendingAmendments = built.amendments;
            warnings.push(...getPendingAmendmentWarnings(built, result.lawTitle));
          } catch {
            degraded = true;
            partialFailures.push({ source: 'egov', target: `law_revisions:${result.lawId}`, reason: 'upstream_unavailable' });
            observabilityRegistry.recordPartialFailure('egov', 1);
            warnings.push({
              code: 'PENDING_AMENDMENT_CHECK_FAILED',
              message: `${result.lawTitle}: 未施行改正の確認に失敗しました。時間をおいて再試行してください。`,
            });
          }
        }

        const status: 'ok' | 'partial' = partialFailures.length > 0 ? 'partial' : 'ok';
        const envelope = {
          status,
          retryable: false,
          degraded,
          warnings,
          partial_failures: partialFailures,
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
            revision_metadata: revisionMetadata,
            pending_amendments: pendingAmendments,
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
