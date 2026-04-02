/**
 * MCP プロンプト定義
 * 社労士実務に沿ったワークフローテンプレートを提供する
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  registerLaborLawResearchPrompt(server);
  registerTsutatsuResearchPrompt(server);
  registerSafetyHealthResearchPrompt(server);
}

/**
 * 労務法令調査プロンプト
 *
 * 指定テーマについて法令→条文→通達の流れで調査するワークフロー。
 * 社労士の法令調査実務を想定。
 */
function registerLaborLawResearchPrompt(server: McpServer) {
  server.prompt(
    'labor_law_research',
    '労務テーマについて法令・通達を体系的に調査する。法令の根拠条文と行政通達を併せて確認するワークフロー。',
    {
      topic: z.string().describe(
        '調査テーマ。例: "時間外労働の上限規制", "育児休業の取得要件", "社会保険の適用拡大", "有期雇用の無期転換"'
      ),
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `以下のテーマについて、労働・社会保険法令の調査を行ってください。

## 調査テーマ
${args.topic}

## 調査手順

1. **関連法令の特定**
   - search_law でテーマに関連する法令を検索
   - 該当する法令名と law_id を確認

2. **根拠条文の取得**
   - get_law で該当法令の関連条文を取得
   - 略称も活用可能（労基法、安衛法、雇保法、健保法、厚年法、育介法、均等法、派遣法 等）
   - 必要に応じて施行令・施行規則の条文も確認

3. **関連通達の検索**（並行して実行）
   - search_mhlw_tsutatsu でテーマに関連する厚労省通達を検索
   - 安全衛生関連の場合は search_jaish_tsutatsu も併用

4. **通達本文の確認**
   - get_mhlw_tsutatsu または get_jaish_tsutatsu で重要な通達の本文を取得

5. **調査結果のまとめ**
   - 根拠法令・条文の一覧
   - 関連通達の要旨
   - 実務上の留意点

## 注意
- 条文は正確に引用すること
- 通達の発出日・番号を明記すること
- 法改正による条文変更がある場合は最新の条文を確認すること`,
          },
        },
      ],
    })
  );
}

/**
 * 通達調査プロンプト
 *
 * 特定テーマの行政通達を重点的に調査するワークフロー。
 * 厚労省法令等DBとJAISH安全衛生情報センターの両方を活用。
 */
function registerTsutatsuResearchPrompt(server: McpServer) {
  server.prompt(
    'tsutatsu_research',
    '行政通達を重点的に調査する。厚労省法令等DBとJAISH安全衛生情報センターから通達を検索・取得する。',
    {
      keyword: z.string().describe(
        '検索キーワード。例: "36協定", "労災認定基準", "パワーハラスメント", "特定化学物質"'
      ),
      scope: z.enum(['all', 'mhlw', 'jaish']).optional().describe(
        '検索範囲。all=両方（デフォルト）, mhlw=厚労省通達のみ, jaish=安衛通達のみ'
      ),
    },
    async (args) => {
      const scope = args.scope ?? 'all';
      const steps: string[] = [];

      if (scope === 'all' || scope === 'mhlw') {
        steps.push(`- search_mhlw_tsutatsu で「${args.keyword}」を検索`);
        steps.push('- 重要な通達は get_mhlw_tsutatsu で本文を取得');
      }
      if (scope === 'all' || scope === 'jaish') {
        steps.push(`- search_jaish_tsutatsu で「${args.keyword}」を検索（安全衛生関連）`);
        steps.push('- 重要な通達は get_jaish_tsutatsu で本文を取得');
      }

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `「${args.keyword}」に関する行政通達を調査してください。

## 調査手順
${steps.join('\n')}

## 出力形式
各通達について以下を整理してください：
- **通達名**（正式名称）
- **発出日・番号**（例: 令和5年3月14日 基発0314第2号）
- **要旨**（通達の主要ポイントを3〜5行で要約）
- **実務への影響**（事業主・社労士として注意すべき点）

## 注意
- 最新の通達を優先すること
- 改正通達がある場合は最新版を確認すること
- 通達の正式な番号と日付を必ず明記すること`,
            },
          },
        ],
      };
    }
  );
}

/**
 * 安全衛生調査プロンプト
 *
 * 労働安全衛生に特化した調査ワークフロー。
 * 安衛法の条文とJAISH通達を中心に調査。
 */
function registerSafetyHealthResearchPrompt(server: McpServer) {
  server.prompt(
    'safety_health_research',
    '労働安全衛生に関する法令・通達を調査する。安衛法の条文、安衛則、関連通達を体系的に確認するワークフロー。',
    {
      topic: z.string().describe(
        '調査テーマ。例: "健康診断の実施義務", "化学物質管理", "足場の安全基準", "ストレスチェック制度"'
      ),
    },
    async (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `労働安全衛生に関する以下のテーマを調査してください。

## 調査テーマ
${args.topic}

## 調査手順

1. **安衛法の根拠条文**
   - get_law で「安衛法」（労働安全衛生法）の関連条文を取得
   - 必要に応じて「安衛令」（施行令）、「安衛則」（安全衛生規則）も確認

2. **JAISH安衛通達の検索**（並行して実行）
   - search_jaish_tsutatsu でテーマに関連する安衛通達を検索
   - max_pages を増やして古い通達も網羅的に検索

3. **厚労省通達の検索**
   - search_mhlw_tsutatsu で関連する厚労省通達も検索（安衛関連の基発通達等）

4. **重要通達の本文確認**
   - get_jaish_tsutatsu / get_mhlw_tsutatsu で重要な通達の詳細を取得

5. **調査結果のまとめ**
   - 法的根拠（安衛法・安衛則の条文）
   - 関連通達の一覧と要旨
   - 事業者の義務・罰則
   - 実務上の対応ポイント

## 注意
- 安全衛生関連は法令と通達の両方が重要
- じん肺法、作業環境測定法など関連法令にも注意
- 最新の法改正・通達改正を反映すること`,
          },
        },
      ],
    })
  );
}
