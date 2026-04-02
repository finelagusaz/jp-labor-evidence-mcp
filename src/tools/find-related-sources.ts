import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovLawCanonicalId } from '../lib/canonical-id.js';
import { findRelatedSources } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const inputSchema = z.object({
  law_id: z.string().min(1).max(20).describe(
    '確定済みの e-Gov law_id。'
  ),
  article: z.string().min(1).max(20).optional().describe(
    '関連通達検索キーワード生成に使う条文番号。'
  ),
  article_caption: z.string().min(1).max(200).optional().describe(
    '関連通達検索キーワード生成に使う条見出し。'
  ),
});

const outputSchema = createToolEnvelopeSchema(
  z.object({
    law_id: z.string(),
    law_title: z.string(),
    retrieved_at: z.string(),
    delegated_laws: z.array(z.object({
      law_id: z.string(),
      canonical_id: z.string(),
      law_title: z.string(),
      law_type: z.string(),
      aliases: z.array(z.string()),
      source_url: z.string(),
    })),
    search_keywords: z.array(z.string()),
  })
);

export function registerFindRelatedSourcesTool(server: McpServer) {
  server.registerTool(
    'find_related_sources',
    {
      description: '確定済み法令に対して、委任先法令候補と関連通達検索キーワードを列挙する。',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await findRelatedSources({
          lawId: args.law_id,
          article: args.article,
          articleCaption: args.article_caption,
        });

        const envelope = {
          status: 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: result.warnings,
          partial_failures: [],
          data: {
            law_id: result.lawId,
            law_title: result.lawTitle,
            retrieved_at: isoNow(),
            delegated_laws: result.delegatedLaws.map((candidate) => ({
              law_id: candidate.lawId,
              canonical_id: buildEgovLawCanonicalId(candidate.lawId),
              law_title: candidate.lawTitle,
              law_type: candidate.lawType,
              aliases: candidate.aliases,
              source_url: candidate.sourceUrl,
            })),
            search_keywords: result.searchKeywords,
          },
        };

        const lines = result.delegatedLaws.map((candidate, index) =>
          `${index + 1}. ${candidate.lawTitle} (${candidate.lawType})`
        );
        const warningSection = result.warnings.length > 0
          ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';

        return createToolResult(
          'find_related_sources',
          envelope,
          `# Related Sources\n\n法令: ${result.lawTitle}\n委任先候補:\n${lines.join('\n') || 'なし'}\n検索キーワード: ${result.searchKeywords.join(' / ')}${warningSection}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'find_related_sources',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
