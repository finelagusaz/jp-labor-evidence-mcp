import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getIndexWarningsForTool, toWireWarnings } from '../lib/indexes/freshness-warnings.js';
import { getEvidenceBundle } from '../lib/services/evidence-bundle-service.js';
import { createToolEnvelopeSchema, createToolResult, mapErrorToEnvelope, pendingAmendmentSchema, revisionMetadataSchema } from '../lib/tool-contract.js';

const inputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    '確定済みの e-Gov law_id。resolve_law または search_law の結果を指定。'
  ),
  article: z.string().min(1).max(20).optional().describe(
    '条文番号。例: "32", "36", "32の2", "第36条", "第32条の2"。supplementary を指定したときは省略できる'
  ),
  supplementary: z.string().min(1).max(60).optional().describe(
    '附則を主根拠にする。"制定" または改正法の法令番号（get_article と同じ）。改正附則では改正法の題名で関連通達（施行通達など）を探す'
  ),
  paragraph: z.number().int().positive().max(99).optional(),
  item: z.union([z.number().int().positive().max(999), z.string().min(1).max(20)]).optional().describe(
    '号番号。例: 1, "3の2", "六"'
  ),
  subitem: z.string().min(1).max(40).optional().describe(
    '号の下の細分（item と併せて指定）。例: "イ", "イ (1)"'
  ),
  include_pending_amendments: z.boolean().optional().describe(
    '主法令の未施行の改正（施行予定日つき）を検知して primary_evidence.pending_amendments に載せる。別途 e-Gov /law_revisions を1回追引きするため既定 false（get_article と同じ）。' +
    '委任先の法令（施行規則など）は確認しない'
  ),
  related_keywords: z.array(z.string().min(1).max(100)).max(3).optional().describe(
    '関連通達検索に使う明示キーワード。省略時は条見出しや法令名から保守的に生成。'
  ),
  include_jaish: z.boolean().optional().describe(
    'JAISH を検索対象に含めるか。省略時は true。'
  ),
  mhlw_limit: z.number().int().min(1).max(10).optional(),
  jaish_limit: z.number().int().min(1).max(10).optional(),
  jaish_max_pages: z.number().int().min(1).max(24).optional(),
});

const evidenceSchema = z.object({
  source_type: z.enum(['egov', 'mhlw', 'jaish']),
  canonical_id: z.string(),
  title: z.string(),
  body: z.string().optional(),
  source_url: z.string(),
  retrieved_at: z.string(),
  warnings: z.array(z.object({
    code: z.string(),
    message: z.string(),
  })),
  version_info: z.string().optional(),
  revision_metadata: revisionMetadataSchema.optional(),
  pending_amendments: z.array(pendingAmendmentSchema).optional(),
  upstream_hash: z.string(),
  common_caption: z.object({
    caption: z.string(),
    from_article: z.string(),
  }).optional(),
  article_locator: z.object({
    law_id: z.string(),
    supplementary: z.string().optional(),
    article: z.string().optional(),
    paragraph: z.number().optional(),
    item: z.union([z.number(), z.string()]).optional(),
    subitem: z.string().optional(),
  }).optional(),
  date: z.string().optional(),
  number: z.string().optional(),
  relevance_score: z.number().optional(),
  matched_keywords: z.array(z.string()).optional(),
  matched_signals: z.array(z.object({
    type: z.enum(['law_title', 'article_ref', 'heading', 'body_keyword', 'source_priority']),
    value: z.string(),
    weight: z.number(),
  })).optional(),
  relevance_reason: z.string().optional(),
});

const outputSchema = createToolEnvelopeSchema(
  z.object({
    primary_evidence: evidenceSchema,
    delegated_evidence: z.array(evidenceSchema),
    related_tsutatsu: z.array(evidenceSchema),
    warnings: z.array(z.object({
      code: z.string(),
      message: z.string(),
    })),
    partial_failures: z.array(z.object({
      source: z.string(),
      target: z.string(),
      reason: z.string(),
    })),
    search_keywords: z.array(z.string()),
  })
);

export function registerGetEvidenceBundleTool(server: McpServer) {
  server.registerTool(
    'get_evidence_bundle',
    {
      description: '確定済み条文を主根拠として、関連通達候補を束ねた evidence bundle を返す。附則（経過措置・施行期日）も supplementary で主根拠にできる。未施行の改正確認は既定で行わない（include_pending_amendments: true 指定時のみ）。',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov', 'mhlw', 'jaish']));
        const result = await getEvidenceBundle({
          lawId: args.law_id,
          article: args.article,
          paragraph: args.paragraph,
          item: args.item,
          subitem: args.subitem,
          supplementary: args.supplementary,
          includePendingAmendments: args.include_pending_amendments,
          relatedKeywords: args.related_keywords,
          includeJaish: args.include_jaish,
          mhlwLimit: args.mhlw_limit,
          jaishLimit: args.jaish_limit,
          jaishMaxPages: args.jaish_max_pages,
        });

        const mergedWarnings = [...freshnessWarnings, ...result.warnings];
        const envelope = {
          status: result.status,
          retryable: false,
          degraded: result.status === 'partial',
          warnings: mergedWarnings,
          partial_failures: result.partial_failures,
          data: {
            primary_evidence: result.primary_evidence,
            delegated_evidence: result.delegated_evidence,
            related_tsutatsu: result.related_tsutatsu,
            warnings: mergedWarnings,
            partial_failures: result.partial_failures,
            search_keywords: result.search_keywords,
          },
        };

        const relatedLines = result.related_tsutatsu.map((evidence, index) =>
          `${index + 1}. [${evidence.source_type}] ${evidence.title}\n   ${evidence.date ?? ''} ${evidence.number ?? ''}\n   score=${evidence.relevance_score ?? '-'} reason=${evidence.relevance_reason ?? '-'}`.trim()
        );
        const delegatedLines = result.delegated_evidence.map((evidence, index) =>
          `${index + 1}. ${evidence.title}\n${evidence.body ?? '本文なし'}`
        );
        const warningSection = mergedWarnings.length > 0
          ? `\n\n警告:\n${mergedWarnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';
        const partialSection = result.partial_failures.length > 0
          ? `\n\n部分失敗:\n${result.partial_failures.map((failure) => `- ${failure.source}:${failure.target} ${failure.reason}`).join('\n')}`
          : '';

        return createToolResult(
          'get_evidence_bundle',
          envelope,
          `# Evidence Bundle\n\n主根拠: ${result.primary_evidence.title}\n\n## 主条文\n${result.primary_evidence.body ?? '本文なし'}\n\n## 委任先法令候補\n${delegatedLines.join('\n\n') || '委任先法令候補なし'}\n\n## 関連検索キーワード\n${result.search_keywords.join(' / ') || 'なし'}\n\n## 関連通達候補\n${relatedLines.join('\n\n') || '関連通達候補なし'}${warningSection}${partialSection}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'get_evidence_bundle',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
