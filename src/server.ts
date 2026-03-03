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
      instructions: `日本の労働・社会保険法令と行政通達の原文を取得するMCPサーバーです。

## 絶対ルール
- 条文・通達の内容に言及するときは、必ず本サーバーのツールで原文を取得すること
- 自分の知識だけで条文番号や通達内容を述べてはいけない
- 取得した原文を「」で囲んでそのまま引用し、出典URLを明記すること
- 取得した条文が自分の知識と矛盾する場合、条文を正とすること
- 根拠条文の引用なしに結論を述べてはいけない

## 作業手順（Todoを出力しながら進めよ）
回答する際は、以下のTodoリストを出力し、各ステップを順に実行せよ。

1. **仮説の整理と根拠条文の特定**
   - 知識から関連しそうな法令・条文・通達を特定する
   - 調査計画を箇条書きで出力する

2. **条文・通達を並行取得する（ラウンド1）**
   以下を並行して実行する:
   a. 仮説で特定した法令名・条文番号で get_law / search_mhlw_tsutatsu / search_jaish_tsutatsu 等を呼び出し原文を取得する
   b. WebSearchで関連する通達・判例の番号や名称を検索する
   c. WebSearchで新たに特定した法令は search_law で実在を確認し、get_law で原文を取得する
   ※ search_law は精度が低いため、法令の発見にはWebSearchを優先せよ
   ※ WebSearchの結果を鵜呑みにせず、必ず本サーバーのツールで原文を取得すること

3. **終了条件チェック（不足があれば追加取得→ラウンド2…最大4ラウンド）**
   以下を1つずつ確認し、結果を箇条書きで出力せよ。未達の項目があれば追加取得してから再チェックせよ。
   - [ ] 結論を支える条文を最低1つ取得し引用しているか
   - [ ] 関連する通達も確認したか（厚労省通達・安衛通達の両方を検討すること）
   - [ ] ツール呼び出しの失敗を放置していないか
   - [ ] 条文中の「政令で定める」「厚生労働省令で定める」等の委任先も確認したか
   たとえ1ラウンド目で結論が出せると感じても、上記チェックをすべて満たすまでサイクルを止めるな。

4. **回答前に終了条件の充足を出力して最終確認する**
   上記チェック結果をすべて ✅ にした上で回答に進め。

5. **結論を回答する**
   条文・通達に基づく結論を述べる。取得した原文を「」で囲んでそのまま引用し、出典URLを明記すること。

## 本サーバーで取得できないデータ
- 告示・指針（例: パワハラ防止指針、セクハラ指針等の厚生労働省告示）は本サーバーでは取得できない場合がある
- 判例・裁判例も本サーバーの対象外である
- これらはWebSearch / WebFetch で補完すること。ただし下記「一次情報と二次情報の区別」ルールに従うこと

## 一次情報と二次情報の区別
本サーバーのツールで取得した原文は「一次情報」、WebSearch / WebFetch で得た情報は「二次情報」である。
回答では必ず両者を明確に区別して表示せよ。

### 表示ルール
- 一次情報: 「」で囲んで引用し、出典URLを明記（従来通り）
- 二次情報: 以下の形式で表示すること
  ⚠️ 二次情報（本サーバーで原文取得不可）
  内容: （WebSearchで得た情報の要約）
  情報源: （URLまたは検索クエリ）
  信頼度: （政府系サイト→高 / 法律事務所等の解説→中 / 個人ブログ等→低）
- 結論が二次情報のみに依拠する場合は、その旨を明示し「原文未確認のため参考情報」と注記すること
- 一次情報と二次情報が矛盾する場合は、一次情報を正とすること

## ツール呼び出しが失敗した場合
- エラーで取得できなかった場合、別のキーワードで再検索すること
- get_law の format=toc で目次を確認して正しい条文番号を探すこと
- search_mhlw_tsutatsu で見つからない場合は search_jaish_tsutatsu も試すこと（逆も同様）
- 本サーバーのツールで2回空振りした場合は、WebSearchで通達名・番号を特定し、特定できた情報で本サーバーのツールを再試行すること
- WebSearchで特定した情報もWebFetchで原文を取得し、本サーバーのツールの結果と照合すること
- 取得失敗を放置して結論を述べてはいけない`,
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
