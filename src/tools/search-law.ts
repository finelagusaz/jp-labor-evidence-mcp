import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
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
    results: z.array(z.object({
      law_title: z.string(),
      law_id: z.string(),
      canonical_id: z.string(),
      law_num: z.string(),
      law_type: z.string(),
      source_url: z.string(),
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
      try {
        const result = await searchLaw({
          keyword: args.keyword,
          lawType: args.law_type,
          limit: args.limit,
        });
        const retrievedAt = isoNow();
        const sourceUrl = 'https://laws.e-gov.go.jp/';
        const envelope = {
          status: result.results.length === 0 ? 'not_found' as const : 'ok' as const,
          retryable: false,
          degraded: false,
          warnings: [],
          partial_failures: [],
          data: {
            keyword: result.keyword,
            retrieved_at: retrievedAt,
            source_url: sourceUrl,
            results: result.results.map((r) => ({
              law_title: r.lawTitle,
              law_id: r.lawId,
              canonical_id: r.lawId,
              law_num: r.lawNum,
              law_type: r.lawType,
              source_url: r.egovUrl,
            })),
          },
        };

        if (result.results.length === 0) {
          return createToolResult(
            envelope,
            `"${args.keyword}" に一致する法令が見つかりませんでした。\nキーワードを変えて再検索してください（例: 類義語や略称を試す）。\n条文を取得する前に、search_law で正式名称または law_id を確認してください。`,
          );
        }

        const lines = result.results.map((r, i) =>
          `${i + 1}. **${r.lawTitle}**\n   法令番号: ${r.lawNum}\n   law_id: ${r.lawId}\n   種別: ${r.lawType}\n   URL: ${r.egovUrl}`
        );

        return createToolResult(
          envelope,
          `# 法令検索結果: "${args.keyword}"\n\n${lines.join('\n\n')}\n\n---\n出典：e-Gov法令検索（デジタル庁）`,
        );
      } catch (error) {
        const envelope = mapErrorToEnvelope(error);
        return createToolResult(
          envelope,
          `エラー: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  );
}
