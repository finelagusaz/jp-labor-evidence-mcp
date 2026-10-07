import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { buildArticleCanonicalId, buildArticleTitle, type ArticleLocatorParts } from '../lib/article-locator.js';
import { formatArticleBody } from '../lib/egov-parser.js';
import { computeUpstreamHash, buildRevisionMetadata, buildVersionInfoString, getRevisionWarnings, getPendingAmendmentWarnings } from '../lib/evidence-metadata.js';
import { getIndexWarningsForTool, toWireWarnings } from '../lib/indexes/freshness-warnings.js';
import { getArticleByLawId, getPendingAmendments, verifyLatestEnforced } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope, revisionMetadataSchema, pendingAmendmentSchema } from '../lib/tool-contract.js';
import { observabilityRegistry } from '../lib/observability.js';
import type { PendingAmendment } from '../lib/types.js';

const getArticleInputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    'resolve_law または search_law で確定した e-Gov law_id。例: "322AC0000000049"'
  ),
  article: z.string().min(1).max(20).optional().describe(
    '条文番号。例: "32", "36", "32の2", "第36条"。supplementary を指定したときは省略でき、省くと附則の直下（条を持たない附則の項）を対象にする'
  ),
  supplementary: z.string().min(1).max(60).optional().describe(
    '附則を対象にする。"制定" で制定時附則、改正附則は改正法の法令番号で指定する（例: "令和8年法律第46号"、"令和八年法律第四十六号"）。' +
    'revision_metadata.amendment_law_num や pending_amendments[].amendment_law_num をそのまま渡せる（未施行の改正の附則は現行版にまだ無いことがある）。一覧は list_suppl_provisions'
  ),
  paragraph: z.number().int().positive().max(99).optional().describe(
    '項番号（省略時は条文全体）。例: 1, 2'
  ),
  item: z.union([z.number().int().positive().max(999), z.string().min(1).max(20)]).optional().describe(
    '号番号（省略時は項全体）。例: 1, 2, "3の2", "六"。paragraph を省くと全項から探す（複数の項にあればエラー）'
  ),
  subitem: z.string().min(1).max(40).optional().describe(
    '号の下の細分。item と併せて指定する。例: "イ", "イ (1)", "イ-(1)-(i)"'
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
    article: z.string().optional(),
    paragraph: z.number().optional(),
    item: z.union([z.number(), z.string()]).optional(),
    subitem: z.string().optional(),
    common_caption: z.object({
      caption: z.string(),
      from_article: z.string(),
    }).optional().describe(
      'この条が自分の見出しを持たないとき、同じ章・節で直前の条に付いた共通見出し（例: 第32条の2 → 第32条の「労働時間」）。' +
      '法令の書き方の約束から推論したもので、本文（body）には含まれない'
    ),
    supplementary: z.object({
      key: z.string(),
      amend_law_num: z.string().optional(),
      extract: z.boolean(),
    }).optional(),
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
      description: '確定済み law_id に対して、特定条文を厳密に取得する。resolve_law の後段で使用する。附則は supplementary で指定する（経過措置・施行期日の確認）。未施行の改正確認は既定で行わない（include_pending_amendments: true 指定時のみ）。',
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
          subitem: args.subitem,
          supplementary: args.supplementary,
        });

        const locator: ArticleLocatorParts = {
          supplementary: result.supplementary,
          article: args.article,
          paragraph: result.paragraph,
          item: args.item,
          subitem: result.subitem,
        };
        const title = buildArticleTitle(result.lawTitle, locator);
        const body = formatArticleBody(result);
        const versionInfo = buildVersionInfoString(result.lawNum, result.promulgationDate, result.revisionInfo);
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
        const latestEnforcedVerified = await verifyLatestEnforced(result.lawId, result.revisionInfo);
        const revisionMetadata = buildRevisionMetadata(result.revisionInfo, { latestEnforcedVerified });
        const warnings = [
          ...freshnessWarnings,
          ...getRevisionWarnings(result.revisionInfo, result.lawTitle, { latestEnforcedVerified }),
        ];
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
            canonical_id: buildArticleCanonicalId(result.lawId, locator),
            law_id: result.lawId,
            law_title: result.lawTitle,
            article: args.article,
            paragraph: result.paragraph,
            item: args.item,
            subitem: result.subitem,
            common_caption: result.commonCaption && {
              caption: result.commonCaption.caption,
              from_article: result.commonCaption.fromArticle,
            },
            supplementary: result.supplementary && {
              key: result.supplementary.key,
              amend_law_num: result.supplementary.amendLawNum,
              extract: result.supplementary.extract,
            },
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
          `# ${title}\n\n${body}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
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
