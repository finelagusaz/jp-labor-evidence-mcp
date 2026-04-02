# labor-law-mcp Spec

## 1. 目的

`labor-law-mcp` は、日本の労働・社会保険法令および関連行政通達について、AI が参照可能な一次情報を、安全かつ検証可能な形で提供する MCP サーバーである。

本仕様の目的は、現行の「本文取得ツール群」から、以下の性質を備えた「法務一次情報の検証基盤」へ設計を引き上げることである。

- 推測しない
- 壊れても誤魔化さない
- 出典と取得経路を追跡できる
- 外部サイトの揺らぎに対して劣化運転できる
- 上位 LLM に安全な構造化データを返せる

## 2. 設計原則

### 2.1 推測禁止

- `get_*` 系ツールは曖昧入力を勝手に補完してはならない
- 候補が複数ある場合は候補列挙に留め、確定は呼び出し側に委ねる
- 「もっともらしい 1 件目」を採用する挙動は禁止する

### 2.2 一次情報と推論の分離

- 本サーバーの責務は取得、正規化、出典付与、構造化までとする
- 要約、結論生成、実務判断は上位エージェントの責務とする
- サーバーの `instructions` や prompt は、提供していない外部能力を必須化してはならない

### 2.3 失敗の明示

- `not_found` と `unavailable` と `partial` を明確に区別する
- 外部サイト障害、HTML 変更、タイムアウト、バリデーションエラーを握り潰してはならない
- 検索結果 0 件は「検索対象なし」ではなく「確認できた範囲で 0 件」であることを表現できるようにする

### 2.4 監査可能性

- レスポンスには取得元 URL、取得時刻、canonical ID、警告情報を含める
- 同一入力と同一 upstream 状態なら再現可能な結果を返す
- 構造化レスポンスを優先し、表示用 Markdown は二次生成物とする

### 2.5 資源制約の明示

- キャッシュ、同時実行数、レスポンスサイズ、入力長に上限を設ける
- 無制限のメモリ使用や無制限の外部アクセスを禁止する
- 相手先サイト保護のため、ホスト別レート制限と同時実行制御を設ける

## 3. 非目標

- 本サーバー単体で法的結論を生成すること
- 判例、裁判例、告示、ガイドライン等の全取得を初期段階で保証すること
- 任意の自然文から自動で完璧に関連法令を推定すること
- UI 層のレンダリング仕様まで固定すること
- 旧来の Markdown 中心 API との後方互換性を維持すること

## 4. あるべき姿

理想形では、本サーバーは「法令・通達本文の取得ツール群」ではなく、法務 AI が依拠するための一次情報基盤として振る舞う。

そのために備えるべき能力は以下である。

- 法令、政令、省令、通達を共通の evidence モデルで返せる
- 曖昧な識別子を候補列挙と確定に分離できる
- 条文本文だけでなく、出典、取得時刻、委任関係、警告情報を返せる
- サイト障害時に silent failure ではなく degraded 状態を返せる
- 上位エージェントが「この結論は何を根拠にしたか」を機械的に組み立てられる

## 5. 想定利用者と主要ユースケース

### 5.1 想定利用者

- 法務・労務調査を行う AI エージェント
- 社労士・人事担当者向けの社内支援ツール
- 法令根拠を UI に明示したいアプリケーション

### 5.2 主要ユースケース

#### U1. 条文の厳密取得

- 入力された法令識別子を確定する
- 指定条項の原文を取得する
- 出典 URL、取得時刻、識別子を付けて返す

#### U2. 通達の候補探索

- キーワードで通達候補を列挙する
- 取得不能な年度やページがあれば `partial` として明示する

#### U3. 根拠束ね

- 主たる条文
- 委任先の政令・省令
- 関連通達候補

を一つの evidence bundle として返す

## 6. trust boundary

本システムでは、以下の境界を明示的に分離する。

### 6.1 ユーザー入力

- 法令名、条番号、検索語、ページ番号、識別子など
- 不正値、曖昧値、過大入力が入ることを前提とする

### 6.2 上位 LLM / クライアント

- 本サーバーの構造化レスポンスを解釈して要約・説明する主体
- 推論はここで行う
- 本サーバーは推論の正しさを保証しない

### 6.3 外部ソース

- e-Gov API
- MHLW 法令等 DB
- JAISH HTML

これらは可用性、構造、文字コード、意味内容が変化しうる不安定な依存先として扱う。

### 6.4 内部正規化データ

- 外部応答を正規化して得た内部表現
- キャッシュ対象や evidence 生成の基礎となる
- raw response と混同しない

## 7. 現状の主要課題

### 7.1 データ完全性の問題

- 未知の法令名を検索上位 1 件へ暗黙解決している
- レスポンスが Markdown 文字列中心で、構造化が不十分
- 一次情報の取得結果とエラー情報が同じチャネルに混在している

### 7.2 障害隠蔽の問題

- 一部検索処理が例外を握り潰して 0 件扱いになる
- 外部サイトの HTML 変更を可観測にできていない

### 7.3 資源枯渇の問題

- キャッシュが TTL のみで上限なし
- 入力長やレスポンスサイズのハードリミットが不足している
- 外部アクセスの同時実行制御が粗い

### 7.4 責務分離の問題

- サーバー命令文が未提供能力を要求している
- prompt がワークフロー制御と情報取得責務を混在させている

## 8. ロードマップ

### 8.0 進捗サマリ

2026-04-02 時点の整理:

- Phase 0: 完了
- Phase 1: 完了
- Phase 1.5: 完了
- Phase 2: 完了
- Phase 3: 完了
- Phase 4: 未着手

補足:

- Phase 3 の `diff_revision` は「同一法令の改正前後比較」に限定する
- `get_evidence_bundle` は主条文取得を必須成功条件とし、関連探索失敗は `partial_failures` に落とす
- `find_related_sources` における委任先未登録は `warning` であり、runtime degradation ではない

### Phase 0: 緊急安定化

目的: 誤答と資源枯渇を止める。

実施項目:

1. `get_law` の曖昧解決を停止する
2. `instructions` / prompt から未提供能力の必須依存を除去する
3. キャッシュに `maxEntries` を導入する
4. 入力長、ページ数、limit、URL 形式のバリデーションを強化する
5. JAISH 検索の握り潰しをやめ、最小限の `status + warnings + partial_failures` を返す

完了条件:

- 未知法令名で `get_law` が候補補完せず失敗する
- キャッシュサイズが負荷試験で頭打ちになる
- 外部障害時に `0件` ではなく `partial` または `unavailable` が返る
- prompt が本サーバー未提供能力を前提にしない

規模感:

- small

### Phase 1: 契約の再定義

目的: ツール契約を構造化し、上位クライアントが安全に扱えるようにする。

実施項目:

1. MCP wire contract を構造化レスポンスへ移行する
2. `resolve_*` と `get_*` を明確に分離する
3. `warnings`, `partial_failures`, `retrieved_at`, `source_url` を全ツールへ追加する
4. エラー種別を `validation`, `not_found`, `upstream_unavailable`, `parse_error` に整理する
5. `status`, `error_code`, `retryable`, `degraded` の意味を全ツールで統一する

完了条件:

- 主要ツールが Markdown ではなく構造化フィールドを返せる
- 取得失敗の理由をプログラムから判別できる

規模感:

- medium

### Phase 1.5: 観測性の先行導入

目的: 大きな再設計の前に、現行挙動の失敗と劣化を測れるようにする。

実施項目:

1. upstream ごとの成功率、タイムアウト率、parse error 数を記録する
2. partial failure 発生率を記録する
3. cache hit rate と概算使用量を記録する
4. degraded mode 判定に必要なカウンタを用意する

完了条件:

- 主要失敗原因がログまたはメトリクスから区別できる
- degraded 判定が手作業でなく機械的に行える

規模感:

- small

### Phase 2: ソースアダプタの抽象化

目的: e-Gov, MHLW, JAISH の個別実装差異を adapter 層に隔離する。

実施項目:

1. `source adapter` の共通インターフェースを導入する
2. HTTP, decode, parse, normalize を分離する
3. 外部ソース別にレート制限、セマフォ、サーキットブレーカを持たせる
4. fixture ベースの parser 回帰テストを整備する

完了条件:

- HTML 変更による破損が parser テストで検知できる
- 外部ソースごとの劣化運転が可能になる

規模感:

- medium

### Phase 3: 根拠束ね機能の追加

目的: 単発取得ではなく、法務検証ワークフローを支援する。

実施項目:

1. `resolve_law`
2. `get_article`
3. `find_related_sources`
4. `get_evidence_bundle`
5. `diff_revision`

を追加し、上位エージェントが根拠一式を扱えるようにする。

完了条件:

- ある論点について、法令、委任先、関連通達を bundle として返せる

規模感:

- large

### Phase 4: 内部インデックス化

目的: スクレイピング依存を減らし、性能と安定性を高める。

実施項目:

1. 定期同期ジョブで索引データを内部保持する
2. 検索は内部インデックス優先、本文取得のみ外部参照とする
3. 更新検知と差分再取り込みを導入する

完了条件:

- 通常検索が外部 HTML に依存しない
- 外部障害時も既知データ範囲で検索できる

規模感:

- large

現時点の残件:

- 検索が外部 HTML / upstream 検索に依存している
- raw response cache と normalized cache が概念上分かれていても、実装上はまだ明示分離されていない
- freshness を返す内部索引モデルがない
- `Evidence.citations` は未導入

## 9. API 再設計案

### 9.1 基本方針

- 取得系と解決系を分離する
- 構造化レスポンスを基本とし、表示用テキストは補助フィールドとする
- エラーと警告を本文に埋め込まない
- internal model と MCP wire contract を分離する

### 9.2 推奨ツールセット

#### `resolve_law`

目的:
入力された法令名、略称、law_id から確定候補を返す。

入力:

- `query: string`

出力:

- `status: "resolved" | "ambiguous" | "not_found"`
- `candidates: LawCandidate[]`
- `warnings: Warning[]`

備考:

- 曖昧なら 1 件に絞らない
- `get_article` の前段として使う

#### `get_article`

目的:
確定済み法令に対して、特定条項を厳密取得する。

入力:

- `law_id: string`
- `article: string`
- `paragraph?: number`
- `item?: number`

出力:

- `status: "ok" | "not_found" | "unavailable"`
- `evidence: Evidence | null`
- `warnings: Warning[]`

#### `search_law`

目的:
探索用途の候補列挙。

入力:

- `keyword: string`
- `law_type?: enum`
- `limit?: number`

出力:

- `status`
- `results: LawCandidate[]`
- `partial_failures: PartialFailure[]`

#### `search_mhlw_tsutatsu`

目的:
厚労省通達の候補列挙。

出力は `results` に加えて、取得失敗ページや parse warning を含める。

#### `get_mhlw_tsutatsu`

目的:
通達本文取得。

入力は `data_id` と `page_no` を取るが、`page_no` に範囲制限を設ける。

#### `search_jaish_tsutatsu`

目的:
JAISH 通達候補列挙。

出力:

- `status: "ok" | "partial" | "unavailable"`
- `results`
- `searched_pages`
- `failed_pages`
- `warnings`

#### `get_jaish_tsutatsu`

目的:
JAISH 本文取得。

入力は完全 URL ではなく、原則 canonical path のみを受ける。

#### `find_related_sources`

目的:
ある法令条文に対して、委任先法令や関連通達候補を列挙する。

備考:

- 初期実装では簡易でよい
- 後続の bundle 化に繋げる
- discovery 用のツールであり、確定済み根拠を返す責務は持たない

#### `get_evidence_bundle`

目的:
法令条文、委任先、関連通達候補を束ねて返す。

備考:

- 上位エージェントの説明責務を支援するためのツール
- explicit inputs only とし、曖昧検索や暗黙補完は行わない

### 9.3 MCP wire contract

```ts
type ToolStatus = 'ok' | 'partial' | 'not_found' | 'unavailable' | 'invalid';

interface Warning {
  code: string;
  message: string;
}

interface PartialFailure {
  source: string;
  target: string;
  reason: string;
}

interface Citation {
  label: string;
  locator?: string;
}

interface ToolEnvelope<T> {
  status: ToolStatus;
  error_code?: string;
  retryable?: boolean;
  degraded?: boolean;
  warnings: Warning[];
  partial_failures?: PartialFailure[];
  data: T | null;
}
```

### 9.4 内部正規化モデル

```ts
interface Evidence {
  source_type: 'egov' | 'mhlw' | 'jaish';
  canonical_id: string;
  title: string;
  body: string;
  source_url: string;
  retrieved_at: string;
  citations: Citation[];
  version_info?: string;
  upstream_hash?: string;
}
```

### 9.5 表示テキストの扱い

- `body` は一次情報本文
- `rendered_markdown` は任意の補助フィールド
- エラー文や注意文を `body` に混ぜない
- 構造化レスポンスが正であり、表示テキストは二次生成物とする

## 10. ドメインモデル

### 10.1 `LawCandidate`

- `law_id`
- `law_title`
- `law_num`
- `law_type`
- `aliases`
- `source_url`

### 10.2 `Evidence`

- `canonical_id`
- `title`
- `body`
- `source_type`
- `source_url`
- `retrieved_at`
- `warnings`
- `version_info`
- `upstream_hash`

`canonical_id` は source ごとに一意でなければならない。

例:

- `egov:322AC0000000049:article:32`
- `mhlw:00tb2035:page:1`
- `jaish:/anzen/hor/hombun/...`

### 10.3 `EvidenceBundle`

- `primary_evidence`
- `delegated_evidence`
- `related_tsutatsu`
- `warnings`
- `partial_failures`

### 10.4 `ArticleLocator`

- `law_id`
- `article`
- `paragraph`
- `item`

### 10.5 用語

- evidence: 一次情報本文とその出典を組にした正規化データ
- bundle: 複数 evidence を目的別に束ねた返却単位
- degraded: 一部機能を落として継続可能な状態
- wire contract: MCP ツールが外部へ返す契約
- internal normalized model: サーバー内部で保持する正規化済み表現

## 11. エラーモデル

### 11.1 エラー分類

- `ValidationError`
  入力形式不正
- `NotFoundError`
  取得対象が存在しない
- `UpstreamUnavailableError`
  外部サイト障害、タイムアウト、HTTP 5xx
- `ParseError`
  外部応答は取得できたが解析不能
- `AmbiguousInputError`
  候補複数で確定不能

### 11.2 応答方針

- ツールレスポンスでは `status` と `warnings` を返す
- 真に異常な場合のみ `isError: true`
- 部分失敗は正常レスポンスに埋め込み、上位が継続可否を判断できるようにする

### 11.3 degraded mode の定義

- `degraded = true` は「全停止ではないが、完全性または網羅性が下がっている」ことを示す
- 例:
  - 一部年度の JAISH 検索に失敗しつつ、残り年度は検索できた
  - 内部インデックスで候補検索は継続できるが、本文再取得は unavailable
  - parser mismatch により一部フィールドのみ返せる

### 11.4 retryable の定義

- `retryable = true` は短時間後の再試行に意味がある失敗
- 例:
  - timeout
  - upstream 503
- `retryable = false` の例:
  - ValidationError
  - ParseError
  - NotFoundError

## 12. セキュリティと運用制約

### 12.1 入力制約

- キーワード長の上限
- 数値引数の範囲制限
- URL ではなく canonical path 優先
- `law_id`, `data_id` の厳密形式検証

### 12.2 キャッシュ方針

- raw response cache と normalized cache を分離する
- raw response cache は短命、小容量、必要最小限とする
- normalized cache は構造化データのみを保持対象とする
- キャッシュに `maxEntries`, `maxBytes`
- レスポンスサイズ上限
- ホスト別 `maxConcurrency`
- ホスト別 `minIntervalMs`

### 12.3 可観測性

- ツール別成功率
- upstream 別タイムアウト率
- parse error 数
- cache hit rate
- partial failure 発生率

### 12.4 運用判定基準

- 一定期間で upstream timeout rate が閾値超過なら degraded
- parse error rate が閾値超過なら該当 adapter を要調査状態にする
- partial failure rate が急増したら silent failure を疑う

閾値自体は実測に基づいて別紙で管理してよいが、少なくとも「何をもって degraded とみなすか」は仕様に含める。

## 13. データ更新モデル

### 13.1 内部インデックスの同期単位

- 検索用索引
- canonical ID 対応表
- 取得済み metadata

全文は原則として内部インデックスに常時保持しない。

### 13.2 同期方式

- 初期は手動同期または定期フル同期
- 将来的には差分同期と invalidation を導入する
- 同期失敗時は前回正常系の索引を維持する

### 13.3 freshness

- 各索引データには更新時刻を持たせる
- 検索結果には freshness を付与可能にする

## 14. 直近で着手するリファクタ

### 14.0 Phase 0 の分解

Phase 0 は、以下の 5 本のワークストリームに分けて進める。

1. 法令解決の厳格化
2. server / prompt の責務縮小
3. キャッシュ上限導入
4. 入力バリデーション強化
5. JAISH 検索の部分失敗化

着手順は以下とする。

1. 法令解決の厳格化
2. server / prompt の責務縮小
3. JAISH 検索の部分失敗化
4. 入力バリデーション強化
5. キャッシュ上限導入

理由:

- 誤根拠返却の停止を最優先する
- prompt の誤誘導を早期に除去する
- silent failure を止めてから入力制約と資源制約を締める

#### 14.0.1 ワークストリーム A: 法令解決の厳格化

目的:
曖昧な法令名から誤った法令を返す経路を止める。

対象ファイル:

- `src/lib/egov-client.ts`
- `src/lib/law-registry.ts`
- `src/lib/services/law-service.ts`
- `src/tools/get-law.ts`
- `src/tools/search-law.ts`

作業:

1. `resolveLawName` の責務を「alias 解決と strict lookup」に限定する
2. 未知法令名を `searchLaws(name, 1)` へ自動フォールバックする挙動を削除する
3. strict resolve に失敗した場合は `ValidationError` または `AmbiguousInputError` 相当で失敗させる
4. 探索は `search_law` に限定し、取得系と探索系を分離する
5. エラーメッセージに「まず search_law で候補確認」の導線を入れる

受け入れ条件:

- `get_law(law_name="労働")` のような曖昧入力は取得に成功しない
- alias は従来通り解決できる
- 明示的 `law_id` はそのまま取得できる

テスト観点:

- alias 正常系
- 正式名称正常系
- 未登録名称
- 部分一致名称
- 不正形式の `law_id`

#### 14.0.2 ワークストリーム B: server / prompt の責務縮小

目的:
本サーバー未提供の能力を前提とした指示を除去する。

対象ファイル:

- `src/server.ts`
- `src/prompts/index.ts`
- `README.md`

作業:

1. `instructions` から `WebSearch`, `WebFetch` 前提の手順を削除する
2. 「本サーバーが提供するのは一次情報取得であり、結論生成は上位責務」と明記する
3. prompt から未提供能力の必須手順を削除する
4. README の説明も同じ責務境界に合わせて修正する

受け入れ条件:

- server instructions が本サーバー内ツールだけで閉じる
- prompt を見たクライアントが外部能力の不在で手順破綻しない

テスト観点:

- 文面レビュー
- `registerPrompts` の出力確認

#### 14.0.3 ワークストリーム C: JAISH 検索の部分失敗化

目的:
検索失敗を 0 件として偽装しない。

対象ファイル:

- `src/lib/services/jaish-tsutatsu-service.ts`
- `src/lib/jaish-client.ts`
- `src/tools/search-jaish-tsutatsu.ts`
- `src/lib/types.ts`

作業:

1. `catch { continue; }` を廃止する
2. `failed_pages`, `warnings`, `status` を返せる型を追加する
3. 一部成功なら `partial`、全失敗なら `unavailable` とする
4. ツールの表示文でも 0 件と取得失敗を区別する

受け入れ条件:

- 一部年度失敗時に `partial` が観測できる
- 全年度失敗時に `0件` ではなく unavailable 相当になる

テスト観点:

- 全成功
- 一部 timeout
- 全失敗
- HTML parse failure

#### 14.0.4 ワークストリーム D: 入力バリデーション強化

目的:
異常入力や過大入力による誤動作と資源浪費を抑える。

対象ファイル:

- `src/tools/get-law.ts`
- `src/tools/search-law.ts`
- `src/tools/search-mhlw-tsutatsu.ts`
- `src/tools/get-mhlw-tsutatsu.ts`
- `src/tools/search-jaish-tsutatsu.ts`
- `src/tools/get-jaish-tsutatsu.ts`
- 各 service / client

作業:

1. `zod` で文字列長、数値範囲、形式制約を追加する
2. service / client 層でも再検証する
3. `article`, `page`, `limit`, `page_no`, `max_pages`, `data_id`, `url/path` に個別制約を設ける
4. エラーを `ValidationError` に寄せる

受け入れ条件:

- 空文字、異常に長い文字列、不正な数値範囲が入口で拒否される
- ツール層を経由しない呼び出しでも service 側で防げる

テスト観点:

- 空文字
- 超長文
- 負数
- 上限超過
- 不正パス

#### 14.0.5 ワークストリーム E: キャッシュ上限導入

目的:
長寿命プロセスでのメモリ枯渇を防ぐ。

対象ファイル:

- `src/lib/cache.ts`
- `src/lib/egov-client.ts`
- `src/lib/mhlw-client.ts`
- `src/lib/jaish-client.ts`

作業:

1. TTLCache に `maxEntries` を追加する、または LRU に差し替える
2. source ごとに上限値を設定する
3. 巨大レスポンスはキャッシュ対象外にする
4. raw response を保持し続けない方針を明文化する

受け入れ条件:

- ユニークキーを大量投入しても cache size が頭打ちになる
- キャッシュ eviction が正常に起きる

テスト観点:

- 上限件数超過
- TTL expiry
- 大きすぎる value の非保存

#### 14.0.6 Phase 0 の横断テスト

以下は個別実装後にまとめて確認する。

1. 曖昧法令名で `get_law` が失敗すること
2. 未提供能力前提の instructions が消えていること
3. JAISH 一部失敗が `partial` で表現されること
4. 不正入力が入口で拒否されること
5. キャッシュ上限が効くこと

### 14.1 Phase 4 の分解

Phase 4 は、以下の 5 本のワークストリームに分けて進める。

1. raw cache / normalized cache の明示分離
2. 内部索引スキーマの導入
3. e-Gov 索引の内部化
4. MHLW / JAISH 検索索引の内部化
5. freshness / 同期運用の導入

着手順は以下とする。

1. raw cache / normalized cache の明示分離
2. 内部索引スキーマの導入
3. e-Gov 索引の内部化
4. freshness / 同期運用の導入
5. MHLW / JAISH 検索索引の内部化

理由:

- cache の責務を先に分けないと、内部索引導入後の責務境界が曖昧になる
- e-Gov は API が安定しており、最初の内部化対象として最も堅い
- MHLW / JAISH は Phase 4 後半で HTML 依存を段階的に縮小する

#### 14.1.1 ワークストリーム A: raw cache / normalized cache の明示分離

目的:
外部応答の短期キャッシュと、正規化済みデータの再利用キャッシュを分ける。

対象ファイル:

- `src/lib/cache.ts`
- `src/lib/source-adapters/http-source-adapter.ts`
- 各 source adapter
- `src/lib/services/*`

作業:

1. raw response cache と normalized cache の型と責務を分ける
2. raw response cache は短 TTL、小容量、bytes 上限ありに固定する
3. normalized cache は構造化データのみ保持し、HTML 本文は原則保持しない
4. observability に cache 種別を追加する

受け入れ条件:

- cache dump を見た時に raw と normalized が区別できる
- normalized cache に HTML 生本文が残らない

テスト観点:

- raw cache eviction
- normalized cache hit
- oversized raw response の非保存

#### 14.1.2 ワークストリーム B: 内部索引スキーマの導入

目的:
検索用の内部データモデルを先に固定する。

対象ファイル:

- 新規 `src/lib/indexes/*`
- `src/lib/types.ts`
- `src/lib/canonical-id.ts`

作業:

1. `LawIndexEntry`, `TsutatsuIndexEntry`, `IndexSnapshotMeta` を定義する
2. `canonical_id`, `source_url`, `title`, `aliases`, `updated_at`, `freshness` を含める
3. `Evidence.citations` の最小形を定義する
4. index serialization 形式を決める

受け入れ条件:

- e-Gov / MHLW / JAISH の候補列挙を同一抽象で保持できる
- freshness を index metadata として保持できる

テスト観点:

- schema validation
- serialization / deserialization

#### 14.1.3 ワークストリーム C: e-Gov 索引の内部化

目的:
法令候補検索を外部 API 依存から段階的に切り離す。

対象ファイル:

- `src/lib/services/law-service.ts`
- 新規 `src/lib/indexes/egov-index.ts`
- 新規同期スクリプト

作業:

1. プリセット法令 + alias を内部索引として保持する
2. `resolve_law` と `search_law` を内部索引優先にする
3. 必要時のみ upstream fallback を許す
4. index freshness をレスポンスへ付与可能にする

受け入れ条件:

- 通常の `resolve_law` / `search_law` が upstream を叩かなくても成立する
- fallback の有無が観測できる

テスト観点:

- index hit
- fallback hit
- freshness 付与

#### 14.1.4 ワークストリーム D: freshness / 同期運用の導入

目的:
内部索引の更新時刻と同期状態を管理可能にする。

対象ファイル:

- 新規 `scripts/sync-*`
- 新規 `src/lib/indexes/index-metadata.ts`
- `src/tools/get-observability-snapshot.ts`

作業:

1. index 更新時刻、同期成功時刻、同期失敗時刻を保持する
2. freshness を `get_observability_snapshot` から見えるようにする
3. 同期失敗時は前回正常 index を保持する
4. degraded 判定に `stale_index` を追加する

受け入れ条件:

- index の鮮度をプログラムから判定できる
- 同期失敗で検索機能が即死しない

テスト観点:

- stale index
- sync failure fallback
- snapshot exposure

#### 14.1.5 ワークストリーム E: MHLW / JAISH 検索索引の内部化

目的:
スクレイピング依存の候補検索を段階的に縮小する。

対象ファイル:

- 新規 `src/lib/indexes/mhlw-index.ts`
- 新規 `src/lib/indexes/jaish-index.ts`
- `src/lib/services/mhlw-tsutatsu-service.ts`
- `src/lib/services/jaish-tsutatsu-service.ts`

作業:

1. 検索用 metadata を内部 index として保持する
2. 検索は内部 index 優先、本文取得のみ upstream に残す
3. upstream 検索失敗時も既知 index 範囲では候補列挙できるようにする
4. index coverage を observability に出す

受け入れ条件:

- 通常検索が外部 HTML へ依存しない
- 外部障害時も既知範囲で候補列挙できる

テスト観点:

- index-only search
- upstream search unavailable
- stale but usable search

#### 14.1.6 Phase 4 の横断テスト

以下は個別実装後にまとめて確認する。

1. `resolve_law` / `search_law` が index hit で完結すること
2. MHLW / JAISH 検索が upstream unavailable でも既知 index で候補を返せること
3. freshness が snapshot から読めること
4. stale index が degraded 判定に反映されること
5. raw cache と normalized cache の責務が分離されていること

### Step 1: 法令解決を分離する

対象:

- `src/lib/egov-client.ts`
- `src/tools/get-law.ts`
- `src/lib/services/law-service.ts`

作業:

- 未知法令名の自動 1 件採用を廃止
- `resolveLawName` を strict resolve と candidate search に分離
- `get_law` は strict resolve のみ許容

期待効果:

- 誤法令引用の根本原因を除去する

### Step 2: キャッシュ実装を差し替える

対象:

- `src/lib/cache.ts`
- 各 client / service

作業:

- TTLCache を LRU + TTL へ置換
- キャッシュ件数上限を source ごとに設定
- 巨大レスポンスをキャッシュ対象外にする

期待効果:

- メモリ枯渇リスクを下げる

### Step 3: 部分失敗モデルを入れる

対象:

- `src/lib/services/jaish-tsutatsu-service.ts`
- `src/lib/services/mhlw-tsutatsu-service.ts`
- `src/tools/search-jaish-tsutatsu.ts`
- `src/tools/search-mhlw-tsutatsu.ts`

作業:

- `catch { continue; }` を廃止
- `failed_pages`, `warnings`, `status` を返す
- 0 件と取得失敗を区別する

期待効果:

- silent failure を排除する

### Step 4: 構造化レスポンスへ移行する

対象:

- 全 tool
- `src/lib/types.ts`

作業:

- 共通レスポンス型を導入
- 出典、本文、警告、エラー理由を分離
- 表示用 Markdown は最小限のラッパーにする

期待効果:

- 上位クライアントが安全に扱える

### Step 5: instructions / prompts を縮小する

対象:

- `src/server.ts`
- `src/prompts/index.ts`

作業:

- 未提供能力前提の命令を削除
- サーバーの責務を「一次情報取得」に限定
- プロンプトは任意テンプレートに留め、必須手順を押し付けない

期待効果:

- 責務境界が明確になる

### Step 6: テストを敵対系へ広げる

対象:

- 新規 `tests/`

作業:

- 曖昧入力
- 長大入力
- 巨大件数のユニークキー
- upstream 障害
- parser 破損

の回帰テスト追加

期待効果:

- 壊れ方を仕様として固定できる
- contract test で `status`, `warnings`, `retryable`, `degraded` の意味を固定できる

## 15. 例

### 15.1 条文取得の正常例

1. `resolve_law("労基法")`
2. `status = "resolved"`
3. `data.candidates[0].law_id = "322AC0000000049"`
4. `get_article(law_id="322AC0000000049", article="32")`
5. `status = "ok"`
6. `data.evidence.canonical_id = "egov:322AC0000000049:article:32"`

### 15.2 JAISH 検索の partial 例

1. `search_jaish_tsutatsu(keyword="足場", max_pages=5)`
2. 2 年度分で timeout
3. `status = "partial"`
4. `degraded = true`
5. `partial_failures` に失敗年度が入る

## 16. マイルストーン定義

### M1

- `get_law` が曖昧入力を補完しない
- prompt / instructions が未提供能力に依存しない
- キャッシュ上限あり
- JAISH 検索が最小限の `status + warnings + partial_failures` を返す
- これらを検証するテストが存在する

### M2

- 主要ツールが構造化 wire contract を返す
- `status`, `error_code`, `retryable`, `degraded` の意味が固定される
- contract test が存在する

### M3

- `resolve_law` と `get_article` を分離
- source adapter 分離
- parser fixture テスト整備

### M4

- `get_evidence_bundle` 実装
- 内部インデックスの初期同期が可能

## 17. 実装判断基準

実装候補が複数ある場合は、以下の順で優先する。

1. 誤った根拠を返さない
2. 失敗を隠さない
3. 上位が監査できる
4. 相手先サイトに優しい
5. 開発・運用コストが低い

この優先順位に反する便利機能は採用しない。
