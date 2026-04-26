# jp-labor-evidence-mcp

[![npm version](https://img.shields.io/npm/v/jp-labor-evidence-mcp.svg)](https://www.npmjs.com/package/jp-labor-evidence-mcp)
[![license](https://img.shields.io/npm/l/jp-labor-evidence-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

日本の労働・社会保険法令と行政通達の一次情報を取得する MCP サーバーです。

> [!NOTE]
> このサーバーの役割は、上位クライアントに法的結論を出させることではなく、e-Gov、厚生労働省法令等データベース、JAISH から原文・候補・出典を取得させ、根拠のない引用やハルシネーションを減らすことです。主契約は構造化レスポンス (`structuredContent`) であり、Markdown テキストは表示用の補助です。

## 目次

- [概要](#概要)
- [クイックスタート](#クイックスタート)
- [ツール](#ツール)
- [使い方の例](#使い方の例)
- [対応法令プリセット](#対応法令プリセット)
- [検索 contract](#検索-contract)
- [Evidence Bundle のスコアリング](#evidence-bundle-のスコアリング)
- [Index と sync](#index-と-sync)
- [制約と注意](#制約と注意)
- [出典](#出典)
- [参考](#参考)
- [貢献・リリース](#貢献リリース)
- [ライセンス](#ライセンス)

## 概要

### できること

- e-Gov から法令候補を解決し、条文を取得する
- 厚労省通達と JAISH 安衛通達を検索し、本文を取得する
- 主条文、委任先法令候補、関連通達候補を `evidence bundle` として束ねる
- 同一法令の改正前後に相当する 2 つの `law_id` を比較し、構造化 diff を返す
- 候補検索を internal index 優先で処理し、observability と sync 基盤を持つ

### スコープ

- 一次情報の取得
- 候補検索
- 出典 URL と監査向け metadata の返却

### 対象外

- 法的結論の断定
- 実務判断
- 判例・裁判例の取得
- 告示・指針など未対応資料の原文保証

## クイックスタート

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

## ツール

### 正規ツール

| ツール                       | 用途                                              |
|------------------------------|---------------------------------------------------|
| `resolve_law`                | 法令名・略称・`law_id` から候補を確定する         |
| `get_article`                | 確定済み `law_id` と条番号から条文を取得する      |
| `search_law`                 | 法令候補を検索する                                |
| `find_related_sources`       | 委任先法令候補と関連通達検索キーワードを返す      |
| `get_evidence_bundle`        | 主条文、委任先法令、関連通達候補を束ねて返す      |
| `diff_revision`              | 同一法令の 2 つの `law_id` 上で同一条文を比較する |
| `search_mhlw_tsutatsu`       | 厚労省通達を検索する                              |
| `get_mhlw_tsutatsu`          | `data_id` から厚労省通達本文を取得する            |
| `search_jaish_tsutatsu`      | JAISH 安衛通達を検索する                          |
| `get_jaish_tsutatsu`         | URL または path から JAISH 通達本文を取得する     |
| `get_observability_snapshot` | cache / upstream / tool / index の状態を見る      |

### 旧互換ツール

| ツール    | 用途                                                                       |
|-----------|----------------------------------------------------------------------------|
| `get_law` | 非推奨。旧来の法令取得。新規利用では `resolve_law` と `get_article` を使う |

## 使い方の例

### 法令条文

> 労働基準法第32条を取得して

1. `resolve_law(query="労働基準法")`
2. `get_article(law_id="322AC0000000049", article="32")`

法令本文の取得は `resolve_law` で `law_id` を確定してから `get_article` を呼ぶのが正規ルートです。

### 略称

> 安衛法の第59条を見せて

1. `resolve_law(query="安衛法")`
2. `get_article(law_id="347AC0000000057", article="59")`

### 根拠セット（条文＋委任先＋関連通達）

> 労働基準法第32条の根拠一式を集めて

1. `resolve_law(query="労働基準法")`
2. `get_evidence_bundle(law_id="322AC0000000049", article="32")`

`get_evidence_bundle` は `primary_evidence` / `delegated_evidence` / `related_tsutatsu` / `warnings` / `partial_failures` / `search_keywords` を返します。

### 改正前後の比較

> 旧法と新法で第32条がどう変わったか比較して

1. `diff_revision(base_law_id="<old-law-id>", head_law_id="<new-law-id>", article="32")`

> [!WARNING]
> `diff_revision` は **同一法令の同一条番号** だけを比較対象とします。異なる法令同士の比較は受け付けません。

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

## 対応法令プリセット

内部 registry には **41 法令** の `law_id` と略称を同梱しています。代表例:

- 労働基準法（労基法）
- 労働安全衛生法（安衛法）
- 雇用保険法（雇保法）
- 健康保険法（健保法）
- 厚生年金保険法（厚年法）

略称表記の例: `労基法` / `安衛法` / `パワハラ防止法` 等。

全 41 法令の一覧と略称、委任関係は [docs/supported-laws.md](docs/supported-laws.md) をご覧ください。registry にない法令も、`resolve_law` は e-Gov 検索の厳密一致から候補補完することがあります（曖昧入力の自動採用はしません）。

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

| 値                         | 意味                                                 |
|----------------------------|------------------------------------------------------|
| `index_only`               | internal index だけで返した                          |
| `upstream_fallback`        | index に候補がなく upstream 検索へフォールバックした |
| `stale_but_usable`         | stale index だが既知候補なので index を使った        |
| `coverage_below_threshold` | coverage が低いため unsafe な fallback を抑止した    |

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

## 貢献・リリース

開発フロー、`npm run release:check` の内容、リリース運用手順は [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。変更履歴は [CHANGELOG.md](CHANGELOG.md) に記録しています。

bug report / feature request は [GitHub issue](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues) からお願いいたします。

## ライセンス

MIT
