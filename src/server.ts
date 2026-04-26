import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetArticleTool } from './tools/get-article.js';
import { registerGetEvidenceBundleTool } from './tools/get-evidence-bundle.js';
import { registerDiffRevisionTool } from './tools/diff-revision.js';
import { registerFindRelatedSourcesTool } from './tools/find-related-sources.js';
import { registerGetObservabilitySnapshotTool } from './tools/get-observability-snapshot.js';
import { registerGetLawTool } from './tools/get-law.js';
import { registerResolveLawTool } from './tools/resolve-law.js';
import { registerSearchLawTool } from './tools/search-law.js';
import { registerSearchMhlwTsutatsuTool } from './tools/search-mhlw-tsutatsu.js';
import { registerGetMhlwTsutatsuTool } from './tools/get-mhlw-tsutatsu.js';
import { registerSearchJaishTsutatsuTool } from './tools/search-jaish-tsutatsu.js';
import { registerGetJaishTsutatsuTool } from './tools/get-jaish-tsutatsu.js';
import { registerPrompts } from './prompts/index.js';

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'jp-labor-evidence-mcp',
      version: '0.4.0',
    },
    {
      instructions: `日本の労働・社会保険法令と行政通達の一次情報を取得するMCPサーバーです。

## サーバーの責務
- 本サーバーの責務は、法令・通達の原文取得、候補検索、出典URLの提示です
- 法的結論、要約、実務判断は上位クライアントの責務です

## 利用ルール
- 条文や通達に言及する場合は、必ず本サーバーのツールで取得した一次情報に基づくこと
- 取得した原文を引用する場合は、出典URLを明記すること
- 法令本文の取得は resolve_law で law_id を確定し、その後 get_article を使うこと
- ツール呼び出しが失敗した場合は、失敗を明示し、別ツールまたは別条件で再試行すること

## 取得対象外
- 判例・裁判例
- 告示・指針など、本サーバーが対応していない資料

これらは本サーバーの取得対象外であり、本サーバー単体では原文取得を保証しません。

## freshness warnings の扱い

tool response の warnings[] に以下の code が含まれる場合、回答本文に根拠を引用する前に、日本語で短く disclaim してください：

- BUNDLED_INDEX_AGED: 内蔵法令インデックスが古くなっています。最新改正が反映されていない可能性を利用者に伝えてください。
- RUNTIME_INDEX_STALE: 通達／判例インデックスが古くなっています。同じキーワードで再検索を試すよう利用者に案内してください。

warnings の message は既に利用者向け日本語になっています。paraphrase せず、そのまま引用することを推奨します。`,
    },
  );

  // 法令ツール（e-Gov API v2）
  registerResolveLawTool(server);   // resolve_law: 法令候補の確定
  registerGetArticleTool(server);   // get_article: law_id 指定で条文取得
  registerFindRelatedSourcesTool(server); // find_related_sources: 委任先法令と探索キーワード
  registerGetEvidenceBundleTool(server); // get_evidence_bundle: 条文 + 関連通達候補の束ね
  registerDiffRevisionTool(server);  // diff_revision: 2 law_id 間の条文差分
  registerGetLawTool(server);       // get_law: 旧互換ツール（非推奨）
  registerSearchLawTool(server);    // search_law: 法令キーワード検索

  // 厚労省通達ツール（法令等データベース）
  registerSearchMhlwTsutatsuTool(server);  // search_mhlw_tsutatsu: 通達検索
  registerGetMhlwTsutatsuTool(server);     // get_mhlw_tsutatsu: 通達本文取得

  // JAISH安衛通達ツール（安全衛生情報センター）
  registerSearchJaishTsutatsuTool(server);  // search_jaish_tsutatsu: 安衛通達検索
  registerGetJaishTsutatsuTool(server);     // get_jaish_tsutatsu: 安衛通達本文取得

  // 観測性
  registerGetObservabilitySnapshotTool(server); // get_observability_snapshot: メトリクス確認

  // プロンプトテンプレート
  registerPrompts(server);

  return server;
}
