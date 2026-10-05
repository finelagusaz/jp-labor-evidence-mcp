import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { buildEgovSupplCanonicalId } from '../lib/canonical-id.js';
import { buildRevisionMetadata, buildVersionInfoString } from '../lib/evidence-metadata.js';
import { getIndexWarningsForTool, toWireWarnings } from '../lib/indexes/freshness-warnings.js';
import { listSupplProvisionsByLawId } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope, revisionMetadataSchema } from '../lib/tool-contract.js';

const inputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    'resolve_law で確定した e-Gov law_id。例: "322AC0000000049"'
  ),
  amendment_law_num: z.string().min(1).max(60).optional().describe(
    '改正法の法令番号で絞り込む。年だけでもよい。例: "令和8年"、"令和8年法律第46号"、"令和八年法律第四十六号"'
  ),
  limit: z.number().int().positive().max(200).optional().describe('最大件数（既定 30、最大 200）'),
  offset: z.number().int().min(0).optional().describe('先頭から飛ばす件数（既定 0）'),
});

const outputSchema = createToolEnvelopeSchema(
  z.object({
    law_id: z.string(),
    law_title: z.string(),
    source_url: z.string(),
    retrieved_at: z.string(),
    version_info: z.string().optional(),
    revision_metadata: revisionMetadataSchema.optional(),
    total: z.number(),
    has_more: z.boolean(),
    items: z.array(z.object({
      key: z.string(),
      canonical_id: z.string(),
      amend_law_num: z.string().optional(),
      extract: z.boolean(),
      article_nums: z.array(z.string()),
      article_count: z.number(),
      paragraph_count: z.number(),
    })),
  })
);

export function registerListSupplProvisionsTool(server: McpServer) {
  server.registerTool(
    'list_suppl_provisions',
    {
      description:
        '法令の附則を新しい順（公布日）に一覧する。経過措置・施行期日を調べるときに、get_article の supplementary に渡す key を確かめるために使う。' +
        '制定時附則は最も古いため既定の件数では外れることがあるが、get_article で supplementary: "制定" と指定すれば直接取得できる。',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
        const result = await listSupplProvisionsByLawId({
          lawId: args.law_id,
          amendmentLawNum: args.amendment_law_num,
          limit: args.limit,
          offset: args.offset,
        });
        const items = result.items.map((item) => ({
          key: item.key,
          canonical_id: buildEgovSupplCanonicalId(result.lawId, item.key),
          amend_law_num: item.amendLawNum,
          extract: item.extract,
          article_nums: item.articleNums,
          article_count: item.articleCount,
          paragraph_count: item.paragraphCount,
        }));
        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: freshnessWarnings,
          partial_failures: [],
          data: {
            law_id: result.lawId,
            law_title: result.lawTitle,
            source_url: result.egovUrl,
            retrieved_at: isoNow(),
            version_info: buildVersionInfoString(result.lawNum, result.promulgationDate, result.revisionInfo),
            revision_metadata: buildRevisionMetadata(result.revisionInfo),
            total: result.total,
            has_more: result.hasMore,
            items,
          },
        };
        const lines = items.map((item) => {
          const label = item.key === '制定' ? '制定時附則' : item.key;
          const extract = item.extract ? '（抄）' : '';
          const body = item.article_count > 0
            ? `条: ${item.article_nums.join(', ')}${item.article_count > item.article_nums.length ? ` ほか（全${item.article_count}条）` : ''}`
            : `条なし・項${item.paragraph_count}件`;
          return `- ${label}${extract} — ${body}`;
        });
        const range = items.length > 0 ? `${(args.offset ?? 0) + 1}〜${(args.offset ?? 0) + items.length}件目` : '0件';
        return createToolResult(
          'list_suppl_provisions',
          envelope,
          `# ${result.lawTitle} — 附則一覧（全${result.total}件中 ${range}、新しい順）\n\n${lines.join('\n') || '（該当する附則はありません）'}${result.hasMore ? '\n\n（続きは offset を指定して取得）' : ''}\n\n---\n出典：e-Gov法令検索（デジタル庁）\nURL: ${result.egovUrl}`,
          startedAt,
        );
      } catch (error) {
        return createToolResult(
          'list_suppl_provisions',
          mapErrorToEnvelope(error),
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
