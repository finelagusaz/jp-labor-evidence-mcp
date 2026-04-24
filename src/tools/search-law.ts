import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildEgovLawCanonicalId } from '../lib/canonical-id.js';
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
import type { CitationBasis } from '../lib/indexes/types.js';
import { searchLaw } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const searchLawInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe(
    '検索キーワード。例: "労働基準", "雇用保険", "安全衛生", "育児休業", "厚生年金"'
  ),
  law_type: z.enum(['Act', 'CabinetOrder', 'MinisterialOrdinance']).optional().describe(
    '法令種別で絞り込み。Act=法律, CabinetOrder=政令（施行令）, MinisterialOrdinance=省令（施行規則）'
  ),
  limit: z.number().int().min(1).max(20).optional().describe(
    '取得件数（デフォルト10、最大20）'
  ),
});

const searchLawOutputSchema = createToolEnvelopeSchema(
  z.object({
    keyword: z.string(),
    retrieved_at: z.string(),
    source_url: z.string(),
    used_index: z.boolean(),
    route: z.enum(['index_only', 'upstream_fallback', 'stale_but_usable', 'coverage_below_threshold']),
    index_freshness: z.enum(['fresh', 'stale', 'unknown']).optional(),
    results: z.array(z.object({
      law_title: z.string(),
      law_id: z.string(),
      canonical_id: z.string(),
      law_num: z.string(),
      law_type: z.string(),
      source_url: z.string(),
      freshness_status: z.enum(['fresh', 'stale', 'unknown']),
      citation_basis: z.enum(['index', 'upstream']),
      indexed_at: z.string().optional(),
      retrieved_at: z.string().optional(),
      citations: z.array(z.object({
        label: z.string(),
        locator: z.string().optional(),
        source_type: z.enum(['egov', 'mhlw', 'jaish']).optional(),
        source_url: z.string().optional(),
        indexed_at: z.string().optional(),
        retrieved_at: z.string().optional(),
        citation_basis: z.enum(['index', 'upstream']).optional(),
      })),
    })),
  })
);

export function registerSearchLawTool(server: McpServer) {
  server.registerTool(
    'search_law',
    {
      description: '労働・社会保険関連の法令をキーワードで検索する。法令名が分からない場合に使用。e-Gov法令API v2を使用。',
      inputSchema: searchLawInputSchema,
      outputSchema: searchLawOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      try {
        const result = await searchLaw({
          keyword: args.keyword,
          lawType: args.law_type,
          limit: args.limit,
        });
        const retrievedAt = isoNow();
        const sourceUrl = 'https://laws.e-gov.go.jp/';
        const candidateBasis: CitationBasis = result.usedIndex ? 'index' : 'upstream';
        const indexLine = `検索経路: ${result.route}${result.indexMeta ? ` / freshness=${result.indexMeta.freshness}` : ''}`;
        const freshnessWarnings = getIndexWarningsForTool(['egov']).map(({ code, message }) => ({ code, message }));
        const envelope = {
          status: result.results.length === 0 ? 'not_found' as const : 'ok' as const,
          retryable: false,
          degraded: result.route !== 'index_only',
          warnings: [...freshnessWarnings, ...result.warnings],
          partial_failures: [],
          data: {
            keyword: result.keyword,
            retrieved_at: retrievedAt,
            source_url: sourceUrl,
            used_index: result.usedIndex,
            route: result.route,
            index_freshness: result.indexMeta?.freshness,
            results: result.results.map((r) => ({
              law_title: r.lawTitle,
              law_id: r.lawId,
              canonical_id: buildEgovLawCanonicalId(r.lawId),
              law_num: r.lawNum,
              law_type: r.lawType,
              source_url: r.egovUrl,
              freshness_status: result.indexMeta?.freshness ?? 'unknown',
              citation_basis: candidateBasis,
              indexed_at: candidateBasis === 'index' ? result.indexMeta?.generated_at : undefined,
              retrieved_at: candidateBasis === 'upstream' ? retrievedAt : undefined,
              citations: [{
                label: r.lawTitle,
                locator: r.lawId,
                source_type: 'egov',
                source_url: r.egovUrl,
                indexed_at: candidateBasis === 'index' ? result.indexMeta?.generated_at : undefined,
                retrieved_at: candidateBasis === 'upstream' ? retrievedAt : undefined,
                citation_basis: candidateBasis,
              }],
            })),
          },
        };

        if (result.results.length === 0) {
          return createToolResult(
            'search_law',
            {
              ...envelope,
              error_code: 'not_found',
            },
            `"${args.keyword}" に一致する法令が見つかりませんでした。\n${indexLine}\nキーワードを変えて再検索してください（例: 類義語や略称を試す）。\n条文を取得する前に、search_law で正式名称または law_id を確認してください。`,
            startedAt,
          );
        }

        const lines = result.results.map((r, i) =>
          `${i + 1}. **${r.lawTitle}**\n   法令番号: ${r.lawNum}\n   law_id: ${r.lawId}\n   種別: ${r.lawType}\n   URL: ${r.egovUrl}`
        );

        return createToolResult(
          'search_law',
          envelope,
          `# 法令検索結果: "${args.keyword}"\n\n${indexLine}\n\n${lines.join('\n\n')}\n\n---\n出典：e-Gov法令検索（デジタル庁）`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'search_law',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
