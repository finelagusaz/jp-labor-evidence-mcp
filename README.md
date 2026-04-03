# jp-labor-evidence-mcp

日本の労働・社会保険法令と行政通達の一次情報を取得する MCP サーバーです。

このサーバーの役割は、上位クライアントに法的結論を出させることではなく、e-Gov、厚生労働省法令等データベース、JAISH から原文・候補・出典を取得させ、根拠のない引用やハルシネーションを減らすことです。主契約は構造化レスポンス (`structuredContent`) であり、Markdown テキストは表示用の補助です。

## 何ができるか

- e-Gov から法令候補を解決し、条文を取得する
- 厚労省通達と JAISH 安衛通達を検索し、本文を取得する
- 主条文、委任先法令候補、関連通達候補を `evidence bundle` として束ねる
- 同一法令の改正前後に相当する 2 つの `law_id` を比較し、構造化 diff を返す
- 候補検索を internal index 優先で処理し、observability と sync 基盤を持つ

## このサーバーの責務

- 一次情報の取得
- 候補検索
- 出典 URL と監査向け metadata の返却

## このサーバーがやらないこと

- 法的結論の断定
- 実務判断
- 判例・裁判例の取得
- 告示・指針など未対応資料の原文保証

## ツール

### 正規ツール

| ツール | 用途 |
|---|---|
| `resolve_law` | 法令名・略称・`law_id` から候補を確定する |
| `get_article` | 確定済み `law_id` と条番号から条文を取得する |
| `search_law` | 法令候補を検索する |
| `find_related_sources` | 委任先法令候補と関連通達検索キーワードを返す |
| `get_evidence_bundle` | 主条文、委任先法令、関連通達候補を束ねて返す |
| `diff_revision` | 同一法令の 2 つの `law_id` 上で同一条文を比較する |
| `search_mhlw_tsutatsu` | 厚労省通達を検索する |
| `get_mhlw_tsutatsu` | `data_id` から厚労省通達本文を取得する |
| `search_jaish_tsutatsu` | JAISH 安衛通達を検索する |
| `get_jaish_tsutatsu` | URL または path から JAISH 通達本文を取得する |
| `get_observability_snapshot` | cache / upstream / tool / index の状態を見る |

### 旧互換ツール

| ツール | 用途 |
|---|---|
| `get_law` | 非推奨。旧来の法令取得。新規利用では `resolve_law` と `get_article` を使う |

## 正規ワークフロー

### 条文を取る

1. `resolve_law(query="労働基準法")`
2. `get_article(law_id="322AC0000000049", article="32")`

法令本文の取得は、`resolve_law` で `law_id` を確定してから `get_article` を呼ぶのが正規ルートです。

### 根拠セットを取る

1. `resolve_law(query="労働基準法")`
2. `get_evidence_bundle(law_id="322AC0000000049", article="32")`

`get_evidence_bundle` は以下を返します。

- `primary_evidence`
- `delegated_evidence`
- `related_tsutatsu`
- `warnings`
- `partial_failures`
- `search_keywords`

### 改正前後を比較する

1. `diff_revision(base_law_id="old-law-id", head_law_id="new-law-id", article="32")`

`diff_revision` は同一法令の同一条番号だけを比較対象とします。異なる法令同士の比較は受け付けません。

## 検索 contract

`search_law`、`search_mhlw_tsutatsu`、`search_jaish_tsutatsu` は、候補一覧だけでなく検索経路と監査 metadata を返します。

主に見るべきフィールド:

- `used_index`
- `route`
- `index_freshness`
- `warnings`
- `citation_basis`
- `indexed_at`
- `retrieved_at`

`route` は次のいずれかです。

- `index_only`
- `upstream_fallback`
- `stale_but_usable`
- `coverage_below_threshold`

意味は以下です。

- `index_only`: internal index だけで返した
- `upstream_fallback`: index に候補がなく upstream 検索へフォールバックした
- `stale_but_usable`: stale index だが既知候補なので index を使った
- `coverage_below_threshold`: coverage が低いため unsafe な fallback を抑止した

候補ごとの監査情報:

- `citation_basis = "index"` のときは `indexed_at` が入り、`retrieved_at` は空
- `citation_basis = "upstream"` のときは `retrieved_at` が入り、`indexed_at` は空

## Evidence Bundle のスコアリング

`related_tsutatsu` は `relevance_score` の降順で返します。単純な件数順ではなく、以下の `match signal` を加点して順位付けします。

- `law_title`
- `article_ref`
- `heading`
- `body_keyword`
- `source_priority`

各候補には `matched_signals` と `relevance_reason` が含まれるため、なぜ上位に来たのかを追跡できます。

## 対応法令プリセット

内部 registry には 41 法令の `law_id` と略称を同梱しています。代表例:

- 労働基準法
- 労働基準法施行令
- 労働基準法施行規則
- 労働安全衛生法
- 労働安全衛生法施行令
- 労働安全衛生規則
- 雇用保険法
- 雇用保険法施行令
- 雇用保険法施行規則
- 健康保険法
- 厚生年金保険法
- 国民年金法
- 育児介護休業法
- 労働者派遣法
- 社会保険労務士法

代表的な略称:

| 略称 | 正式名称 |
|---|---|
| 労基法 | 労働基準法 |
| 安衛法 | 労働安全衛生法 |
| 労災法 | 労働者災害補償保険法 |
| 雇保法 | 雇用保険法 |
| 健保法 | 健康保険法 |
| 厚年法 | 厚生年金保険法 |
| 国年法 | 国民年金法 |
| 育介法 | 育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律 |
| 均等法 | 雇用の分野における男女の均等な機会及び待遇の確保等に関する法律 |
| パワハラ防止法 | 労働施策の総合的な推進並びに労働者の雇用の安定及び職業生活の充実等に関する法律 |

内部 registry にない法令でも、`resolve_law` は e-Gov 検索の厳密一致から候補補完することがあります。ただし曖昧入力を勝手に 1 件採用はしません。

## セットアップ

### `npx` で使う

```json
{
    "mcpServers": {
    "jp-labor-evidence": {
      "command": "npx",
      "args": ["-y", "jp-labor-evidence-mcp"]
    }
  }
}
```

### ソースから使う

この作業リポジトリを使う場合:

```bash
git clone https://github.com/finelagusaz/jp-labor-evidence-mcp.git
cd jp-labor-evidence-mcp
npm install
npm run build
```

ローカル MCP 設定例:

```json
{
  "mcpServers": {
    "jp-labor-evidence": {
      "command": "node",
      "args": ["/path/to/jp-labor-evidence-mcp/dist/index.js"]
    }
  }
}
```

**Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` に追加  
**Claude Code**: `claude mcp add jp-labor-evidence -- node /path/to/jp-labor-evidence-mcp/dist/index.js`

## Index と sync

index 保存先は既定で `./.jp-labor-evidence-indexes` です。`LABOR_LAW_MCP_INDEX_DIR` で変更できます。

```bash
npm run sync:indexes
npm run sync:indexes:full
npm run sync:indexes:incremental
```

- `sync:indexes` は `full sync` の別名
- lock file により並行実行は拒否される
- state は `sync-state.json` に記録される
- `incremental` は change detector に基づいて差分同期を試みる
- baseline 不足や `unknown` 多発時は安全側に倒して full sync を実行する

## npm 公開前チェック

```bash
npm run release:check
```

このチェックは以下を順に実行します。

- `npm test`
- `npm run build`
- `npm pack --dry-run --cache ./.npm-pack-cache`

公開時は npm 側で package 名の空き確認、`npm login`、必要なら 2FA / access token の準備が別途必要です。

## リリース運用

- 変更履歴は [CHANGELOG.md](/Users/Eoh/workspace/labor-law-mcp/CHANGELOG.md) に記録します
- npm 公開時は GitHub tag / Release も合わせて作成します
- bug report と feature request は GitHub issue template から受け付けます

## 使い方の例

### 法令条文

> 労働基準法第32条を取得して

1. `resolve_law(query="労働基準法")`
2. `get_article(law_id="322AC0000000049", article="32")`

### 略称

> 安衛法の第59条を見せて

1. `resolve_law(query="安衛法")`
2. `get_article(law_id="347AC0000000057", article="59")`

### 厚労省通達検索

> 36協定に関する通達を検索して

1. `search_mhlw_tsutatsu(keyword="36協定")`

### JAISH 検索

> 足場に関する安衛通達を検索して

1. `search_jaish_tsutatsu(keyword="足場")`

### 厚労省通達本文

> data_id: 00tb2035 の通達を読みたい

1. `get_mhlw_tsutatsu(data_id="00tb2035")`

### JAISH 通達本文

> /anzen/example.htm を読みたい

1. `get_jaish_tsutatsu(url="/anzen/example.htm")`

## 制約と注意

- 通達検索は internal index 優先だが、coverage や freshness によって route は変わる
- `coverage_below_threshold` のときは fallback を抑止することがある
- `stale_but_usable` は stale index を使っているので、上位クライアント側で注意表示した方がよい
- `diff_revision` は真の改正履歴 API ではなく、同一法令の 2 つの `law_id` 比較である
- 判例・裁判例は対象外

## 出典

- 法令: [e-Gov法令検索](https://laws.e-gov.go.jp/)
- 厚労省通達: [厚生労働省 法令等データベース](https://www.mhlw.go.jp/hourei/)
- 安衛通達: [安全衛生情報センター](https://www.jaish.gr.jp/)

厚労省通達の利用は [厚生労働省ホームページの利用規約](https://www.mhlw.go.jp/chosakuken/index.html) に基づきます。

## 参考

- [tax-law-mcp](https://github.com/kentaroajisaka/tax-law-mcp)
- [e-Gov法令API v2](https://laws.e-gov.go.jp/api/2/swagger-ui)

## ライセンス

MIT
