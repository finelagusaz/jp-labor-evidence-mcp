import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovLawCanonicalId } from '../lib/canonical-id.js';
import { resolveLaw } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const resolveLawInputSchema = z.object({
  query: z.string().min(1).max(200).describe(
    '法令名、略称、または law_id。例: "労基法", "労働基準法", "322AC0000000049"'
  ),
});

const resolveLawOutputSchema = createToolEnvelopeSchema(
  z.object({
    query: z.string(),
    resolution: z.enum(['resolved', 'ambiguous', 'not_found']),
    retrieved_at: z.string(),
    source_url: z.string(),
    used_index: z.boolean(),
    index_freshness: z.enum(['fresh', 'stale', 'unknown']).optional(),
    candidates: z.array(z.object({
      law_id: z.string(),
      canonical_id: z.string(),
      law_title: z.string(),
      law_type: z.string(),
      aliases: z.array(z.string()),
      source_url: z.string(),
    })),
  })
);

export function registerResolveLawTool(server: McpServer) {
  server.registerTool(
    'resolve_law',
    {
      description: '法令名、略称、または law_id から法令候補を確定する。get_article の前段で使用する。',
      inputSchema: resolveLawInputSchema,
      outputSchema: resolveLawOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await resolveLaw({ query: args.query });
        const envelope = {
          status:
            result.resolution === 'resolved' ? 'ok' as const :
            result.resolution === 'ambiguous' ? 'partial' as const :
            'not_found' as const,
          retryable: false,
          degraded: false,
          warnings: result.warnings,
          partial_failures: [],
          data: {
            query: result.query,
            resolution: result.resolution,
            retrieved_at: isoNow(),
            source_url: 'https://laws.e-gov.go.jp/',
            used_index: result.usedIndex,
            index_freshness: result.indexMeta?.freshness,
            candidates: result.candidates.map((candidate) => ({
              law_id: candidate.lawId,
              canonical_id: buildEgovLawCanonicalId(candidate.lawId),
              law_title: candidate.lawTitle,
              law_type: candidate.lawType,
              aliases: candidate.aliases,
              source_url: candidate.sourceUrl,
            })),
          },
        };

        if (result.resolution === 'not_found') {
          return createToolResult(
            'resolve_law',
            {
              ...envelope,
              error_code: 'not_found',
            },
            `「${args.query}」に一致する既知の法令候補は見つかりませんでした。\n必要なら search_law で候補を検索してください。`,
            startedAt,
          );
        }

        const lines = result.candidates.map((candidate, index) =>
          `${index + 1}. **${candidate.lawTitle}**\n   law_id: ${candidate.lawId}\n   種別: ${candidate.lawType}\n   別名: ${candidate.aliases.join('、') || 'なし'}\n   URL: ${candidate.sourceUrl}`
        );

        return createToolResult(
          'resolve_law',
          envelope,
          `# 法令解決結果: "${args.query}"\n\n状態: ${result.resolution}\n\n${lines.join('\n\n')}\n\n---\n次に本文を取得する場合は get_article へ law_id を渡してください。`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'resolve_law',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
