import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetLawTool } from './tools/get-law.js';
import { registerSearchLawTool } from './tools/search-law.js';
import { registerSearchMhlwTsutatsuTool } from './tools/search-mhlw-tsutatsu.js';
import { registerGetMhlwTsutatsuTool } from './tools/get-mhlw-tsutatsu.js';
import { registerSearchJaishTsutatsuTool } from './tools/search-jaish-tsutatsu.js';
import { registerGetJaishTsutatsuTool } from './tools/get-jaish-tsutatsu.js';
import { registerPrompts } from './prompts/index.js';

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'labor-law-mcp',
      version: '0.2.0',
    },
    {
      instructions: `日本の労働・社会保険法令と行政通達の一次情報を取得するMCPサーバーです。

## サーバーの責務
- 本サーバーの責務は、法令・通達の原文取得、候補検索、出典URLの提示です
- 法的結論、要約、実務判断は上位クライアントの責務です

## 利用ルール
- 条文や通達に言及する場合は、必ず本サーバーのツールで取得した一次情報に基づくこと
- 取得した原文を引用する場合は、出典URLを明記すること
- 曖昧な法令名で get_law を呼ばず、必要なら search_law で正式名称または law_id を確認すること
- ツール呼び出しが失敗した場合は、失敗を明示し、別ツールまたは別条件で再試行すること

## 取得対象外
- 判例・裁判例
- 告示・指針など、本サーバーが対応していない資料

これらは本サーバーの取得対象外であり、本サーバー単体では原文取得を保証しません。`,
    },
  );

  // 法令ツール（e-Gov API v2）
  registerGetLawTool(server);       // get_law: 条文取得
  registerSearchLawTool(server);    // search_law: 法令キーワード検索

  // 厚労省通達ツール（法令等データベース）
  registerSearchMhlwTsutatsuTool(server);  // search_mhlw_tsutatsu: 通達検索
  registerGetMhlwTsutatsuTool(server);     // get_mhlw_tsutatsu: 通達本文取得

  // JAISH安衛通達ツール（安全衛生情報センター）
  registerSearchJaishTsutatsuTool(server);  // search_jaish_tsutatsu: 安衛通達検索
  registerGetJaishTsutatsuTool(server);     // get_jaish_tsutatsu: 安衛通達本文取得

  // プロンプトテンプレート
  registerPrompts(server);

  return server;
}
