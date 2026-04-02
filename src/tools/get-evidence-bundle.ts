import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getEvidenceBundle } from '../lib/services/evidence-bundle-service.js';
import { createToolEnvelopeSchema, createToolResult, mapErrorToEnvelope } from '../lib/tool-contract.js';

const inputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    '確定済みの e-Gov law_id。resolve_law または search_law の結果を指定。'
  ),
  article: z.string().min(1).max(20).describe(
    '条文番号。例: "32", "36", "32の2", "第36条"'
  ),
  paragraph: z.number().int().positive().max(99).optional(),
  item: z.number().int().positive().max(999).optional(),
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
  upstream_hash: z.string(),
  article_locator: z.object({
    law_id: z.string(),
    article: z.string(),
    paragraph: z.number().optional(),
    item: z.number().optional(),
  }).optional(),
  date: z.string().optional(),
  number: z.string().optional(),
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
      description: '確定済み条文を主根拠として、関連通達候補を束ねた evidence bundle を返す。',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await getEvidenceBundle({
          lawId: args.law_id,
          article: args.article,
          paragraph: args.paragraph,
          item: args.item,
          relatedKeywords: args.related_keywords,
          includeJaish: args.include_jaish,
          mhlwLimit: args.mhlw_limit,
          jaishLimit: args.jaish_limit,
          jaishMaxPages: args.jaish_max_pages,
        });

        const envelope = {
          status: result.status,
          retryable: false,
          degraded: result.status === 'partial',
          warnings: result.warnings,
          partial_failures: result.partial_failures,
          data: {
            primary_evidence: result.primary_evidence,
            delegated_evidence: result.delegated_evidence,
            related_tsutatsu: result.related_tsutatsu,
            warnings: result.warnings,
            partial_failures: result.partial_failures,
            search_keywords: result.search_keywords,
          },
        };

        const relatedLines = result.related_tsutatsu.map((evidence, index) =>
          `${index + 1}. [${evidence.source_type}] ${evidence.title}\n   ${evidence.date ?? ''} ${evidence.number ?? ''}`.trim()
        );
        const warningSection = result.warnings.length > 0
          ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';
        const partialSection = result.partial_failures.length > 0
          ? `\n\n部分失敗:\n${result.partial_failures.map((failure) => `- ${failure.source}:${failure.target} ${failure.reason}`).join('\n')}`
          : '';

        return createToolResult(
          'get_evidence_bundle',
          envelope,
          `# Evidence Bundle\n\n主根拠: ${result.primary_evidence.title}\n関連検索キーワード: ${result.search_keywords.join(' / ')}\n関連通達候補: ${result.related_tsutatsu.length}件\n\n${relatedLines.join('\n\n') || '関連通達候補なし'}${warningSection}${partialSection}`,
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
