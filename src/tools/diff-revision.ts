import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolEnvelopeSchema, createToolResult, mapErrorToEnvelope } from '../lib/tool-contract.js';
import { diffRevision } from '../lib/services/diff-revision-service.js';

const inputSchema = z.object({
  base_law_id: z.string().min(1).max(20).describe(
    '比較元の e-Gov law_id。例: "322AC0000000049"'
  ),
  head_law_id: z.string().min(1).max(20).describe(
    '比較先の e-Gov law_id。例: "347AC0000000057"'
  ),
  article: z.string().min(1).max(20).describe(
    '比較対象の条文番号。例: "32", "32の2", "第32条"'
  ),
  paragraph: z.number().int().positive().max(99).optional(),
  item: z.number().int().positive().max(999).optional(),
});

const evidenceSchema = z.object({
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
});

const outputSchema = createToolEnvelopeSchema(
  z.object({
    base_evidence: evidenceSchema,
    head_evidence: evidenceSchema,
    summary: z.object({
      changed: z.boolean(),
      inserted_chunks: z.number(),
      deleted_chunks: z.number(),
      unchanged_chunks: z.number(),
    }),
    diff_chunks: z.array(z.object({
      type: z.enum(['equal', 'insert', 'delete']),
      text: z.string(),
    })),
  })
);

export function registerDiffRevisionTool(server: McpServer) {
  server.registerTool(
    'diff_revision',
    {
      description: '2つの e-Gov law_id 上の同一条文を比較し、構造化 diff を返す。',
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await diffRevision({
          baseLawId: args.base_law_id,
          headLawId: args.head_law_id,
          article: args.article,
          paragraph: args.paragraph,
          item: args.item,
        });

        const envelope = {
          status: result.status,
          retryable: false,
          degraded: false,
          warnings: result.warnings,
          partial_failures: [],
          data: {
            base_evidence: result.base_evidence,
            head_evidence: result.head_evidence,
            summary: result.summary,
            diff_chunks: result.diff_chunks,
          },
        };

        const diffLines = result.diff_chunks.map((chunk) => {
          const prefix =
            chunk.type === 'equal' ? '  ' :
            chunk.type === 'insert' ? '+ ' :
            '- ';
          return chunk.text
            .split('\n')
            .map((line) => `${prefix}${line}`)
            .join('\n');
        });
        const warningSection = result.warnings.length > 0
          ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';

        return createToolResult(
          'diff_revision',
          envelope,
          `# Revision Diff\n\n比較元: ${result.base_evidence.title}\n比較先: ${result.head_evidence.title}\n変更あり: ${result.summary.changed ? 'yes' : 'no'}\ninsert=${result.summary.inserted_chunks} delete=${result.summary.deleted_chunks}\n\n${diffLines.join('\n')}${warningSection}`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'diff_revision',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
