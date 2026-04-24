import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildJaishCanonicalId } from '../lib/canonical-id.js';
import type { CitationBasis } from '../lib/indexes/types.js';
import { searchJaishTsutatsu } from '../lib/services/jaish-tsutatsu-service.js';
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope } from '../lib/tool-contract.js';

const searchJaishInputSchema = z.object({
  keyword: z.string().min(1).max(100).describe(
    '検索キーワード。例: "特定化学物質", "有機溶剤", "安全教育", "健康診断", "石綿", "足場"'
  ),
  limit: z.number().int().min(1).max(30).optional().describe(
    '最大取得件数（デフォルト10、最大30）'
  ),
  max_pages: z.number().int().min(1).max(24).optional().describe(
    '検索する年度数（デフォルト5）。増やすと古い通達も検索するが時間がかかる。'
  ),
});

const searchJaishOutputSchema = createToolEnvelopeSchema(
  z.object({
    keyword: z.string(),
    pages_searched: z.number(),
    retrieved_at: z.string(),
    source_url: z.string(),
    used_index: z.boolean(),
    route: z.enum(['index_only', 'upstream_fallback', 'stale_but_usable', 'coverage_below_threshold']),
    index_freshness: z.enum(['fresh', 'stale', 'unknown']).optional(),
    results: z.array(z.object({
      title: z.string(),
      number: z.string(),
      date: z.string(),
      url: z.string(),
      canonical_id: z.string(),
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

export function registerSearchJaishTsutatsuTool(server: McpServer) {
  server.registerTool(
    'search_jaish_tsutatsu',
    {
      description: '安全衛生情報センター（JAISH）から安全衛生関連の通達をキーワード検索する。労働安全衛生法、じん肺法、作業環境測定法等に関する通達を検索可能。',
      inputSchema: searchJaishInputSchema,
      outputSchema: searchJaishOutputSchema,
    },
    async (args) => {
      const startedAt = Date.now();
      const freshnessWarnings = getIndexWarningsForTool(['jaish']).map(({ code, message }) => ({ code, message }));
      try {
        const result = await searchJaishTsutatsu({
          keyword: args.keyword,
          limit: args.limit,
          maxPages: args.max_pages,
        });
        const retrievedAt = isoNow();
        const sourceUrl = 'https://www.jaish.gr.jp/';
        const candidateBasis: CitationBasis = result.usedIndex ? 'index' : 'upstream';
        const indexLine = `検索経路: ${result.route}${result.indexMeta ? ` / freshness=${result.indexMeta.freshness}` : ''}`;
        const envelope = {
          status: result.status,
          error_code: result.status === 'unavailable' ? 'upstream_unavailable' as const : undefined,
          retryable: result.status === 'unavailable',
          degraded: result.status !== 'ok' || result.warnings.length > 0 || result.route !== 'index_only',
          warnings: [...freshnessWarnings, ...result.warnings],
          partial_failures: result.failedPages,
          data: {
            keyword: args.keyword,
            pages_searched: result.pagesSearched,
            retrieved_at: retrievedAt,
            source_url: sourceUrl,
            used_index: result.usedIndex,
            route: result.route,
            index_freshness: result.indexMeta?.freshness,
            results: result.results.map((r) => ({
              title: r.title,
              number: r.number,
              date: r.date,
              url: r.url,
              canonical_id: buildJaishCanonicalId(r.url),
              source_url: r.url.startsWith('http') ? r.url : `https://www.jaish.gr.jp${r.url}`,
              freshness_status: result.indexMeta?.freshness ?? 'unknown',
              citation_basis: candidateBasis,
              indexed_at: candidateBasis === 'index' ? result.indexMeta?.generated_at : undefined,
              retrieved_at: candidateBasis === 'upstream' ? retrievedAt : undefined,
              citations: [{
                label: r.title,
                locator: r.number,
                source_type: 'jaish',
                source_url: r.url.startsWith('http') ? r.url : `https://www.jaish.gr.jp${r.url}`,
                indexed_at: candidateBasis === 'index' ? result.indexMeta?.generated_at : undefined,
                retrieved_at: candidateBasis === 'upstream' ? retrievedAt : undefined,
                citation_basis: candidateBasis,
              }],
            })),
          },
        };

        if (result.status === 'unavailable') {
          const failureLines = result.failedPages.map((failure) =>
            `- ${failure.target}: ${failure.reason}`
          );

          return createToolResult(
            'search_jaish_tsutatsu',
            envelope,
            `# JAISH安衛通達検索結果: 「${args.keyword}」\n\n状態: unavailable\n${indexLine}\n検索対象の年度インデックス取得に失敗しました。\n\n失敗ページ:\n${failureLines.join('\n')}\n\n---\n厚労省通達は search_mhlw_tsutatsu で検索できます。`,
            startedAt,
          );
        }

        const lines = result.results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   日付: ${r.date}\n   番号: ${r.number}\n   url: \`${r.url}\``
        );

        const warningSection = result.warnings.length > 0
          ? `\n\n警告:\n${result.warnings.map((warning) => `- [${warning.code}] ${warning.message}`).join('\n')}`
          : '';
        const failureSection = result.failedPages.length > 0
          ? `\n\n失敗ページ:\n${result.failedPages.map((failure) => `- ${failure.target}: ${failure.reason}`).join('\n')}`
          : '';

        if (result.results.length === 0) {
          return createToolResult(
            'search_jaish_tsutatsu',
            {
              ...envelope,
              status: result.status === 'partial' ? 'partial' as const : 'not_found' as const,
              error_code: result.status === 'partial' ? undefined : 'not_found' as const,
              retryable: result.status === 'partial',
            },
            `# JAISH安衛通達検索結果: 「${args.keyword}」\n\n状態: ${result.status === 'partial' ? 'partial' : 'not_found'}\n${indexLine}\n0件（${result.pagesSearched}年度分を検索）\nmax_pages を増やすと検索範囲が広がります。キーワードを変えて再検索も試してください。${warningSection}${failureSection}\n\n---\n厚労省通達は search_mhlw_tsutatsu で検索できます。`,
            startedAt,
          );
        }

        return createToolResult(
          'search_jaish_tsutatsu',
          envelope,
          `# JAISH安衛通達検索結果: 「${args.keyword}」\n\n状態: ${result.status}\n${indexLine}\n${result.results.length}件（${result.pagesSearched}年度分を検索）\n\n${lines.join('\n\n')}${warningSection}${failureSection}\n\n---\n※ 本文を読むには get_jaish_tsutatsu で url を指定してください。\n出典：安全衛生情報センター（中央労働災害防止協会）`,
          startedAt,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          'search_jaish_tsutatsu',
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
          startedAt,
        );
      }
    }
  );
}
