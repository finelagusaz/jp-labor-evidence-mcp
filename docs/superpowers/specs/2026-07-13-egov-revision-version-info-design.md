# e-Gov 改正メタ → Evidence.revision_metadata / version_info（現行版表示）— 設計仕様 v1

- 日付: 2026-07-13
- ステータス: **Finalized（brainstorming 完了・実装計画待ち）**
- supersedes: [2026-07-13-egov-revision-version-info-backlog.md](2026-07-13-egov-revision-version-info-backlog.md)（backlog メモを本 spec が確定版として置換。未施行改正検知は本 spec の**非目標**＝v2 backlog として当該メモに残す）
- 関連: [2026-07-13-egov-freshness-refresh-design.md](2026-07-13-egov-freshness-refresh-design.md)（4視点レビュー H1「`GENERATED_AT` は改正の最新性を保証しない」への本筋回答）、SPEC `Evidence.version_info`（§9.4/§10.2）
- レビュー: 本設計は brainstorming 中に **5視点のサブエージェント・レビュー**（契約/一次証拠検証/社労士ドメイン/アーキテクチャ/スコープ）を経ており、各指摘の処理を末尾「レビュー台帳」に記録する。

## 1. 動機（category error の是正）

`get_article` は e-Gov API v2 の `GET /api/2/law_data/{lawId}` で law_data を丸ごと取得し、レスポンスに `revision_info` を同梱している。しかし内部型 `EgovLawData`（[src/lib/types.ts:22-34](../../../src/lib/types.ts#L22-L34)）は `law_info` と `law_full_text` しかモデル化しておらず、`revision_info` を**型境界で破棄**している。条文本文は `get_article` が都度 live 取得するため法改正は本文へ常時反映されるが、「**今引いた条文がいつ施行の版か**」「**この法令は現に効力を有するか**」という監査情報が Evidence に出ていない。

これは freshness（内蔵 index の齢）ではなく**根拠（Evidence）の提示点**の問題。既取得の `revision_info` を活用して現行版メタを載せることが H1 への本筋の回答であり、**別エンドポイント・追加リクエストは不要**。

## 2. スコープ（v1 = 現行版表示のみ）

**含む**（すべて既取得 `revision_info` のみ・追加リクエストゼロ）:
- 人間可読 `version_info`（string）の強化：現行版の施行日を明示
- 構造化 `revision_metadata`（object）：機械可読な版メタ＋版固定 URL（監査再現性）
- 警告 `LAW_NOT_CURRENTLY_ENFORCED`：廃止・失効・非現行版を検知
- companion fix：freshness 警告文の過大約束是正

**非目標（v2 backlog へ）**:
- **未施行改正の検知/warning**。`amendment_scheduled_enforcement_date` は「今返っている版を生んだ改正の暫定施行日」であって将来の未施行改正への前方参照では**ない**（§3 の一次証拠）。真の未施行改正検知は別エンドポイント `GET /api/2/law_revisions/{law_id}` で全版を列挙し `current_revision_status == "UnEnforced"` を探す必要があり、追加リクエスト・キャッシュ・エラー処理を伴う。v1 では出さない。
- **和暦併記**（施行日）。era 変換 util を要するため v1 は ISO 固定。改正法番号は API が既に和暦（例「令和八年法律第四十六号」）で返すため情報は保全される。
- `diff_revision`・deprecated `get_law` への version_info 強化の波及（§6.5）。
- 廃止法令のフル UX（廃止日・後継法・時点法令の本文取得など）。
- 条文本文の bundled 化。

## 3. 一次証拠（2026-07-13 に live probe＋公式 OpenAPI で確認）

一次ソース:
- `GET https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049`（労働基準法）、`349AC0000000116`（雇用保険法）
- 公式 OpenAPI: `https://laws.e-gov.go.jp/api/2/swagger-ui/lawapi-v2.yaml`

確認済み事実:

| 事項 | 確認結果 |
|---|---|
| law_data は既定で **JSON**、`revision_info` を同梱 | ✓（`?response_format=json` 不要） |
| フィールド名（`amendment_enforcement_date`, `amendment_law_num`/`_title`/`_id`, `law_revision_id`, `current_revision_status`, `repeal_status`, `amendment_enforcement_comment`, `repeal_date`）| ✓ すべて実在 |
| `current_revision_status` enum（**閉じた4値**）| `CurrentEnforced` / `UnEnforced` / `PreviousEnforced` / `Repeal` |
| `repeal_status` enum（**閉じた5値**）| `None` / `Repeal` / `Expire` / `Suspend` / `LossOfEffectiveness` |
| 「`CurrentEnforced` 以外なら警告」の否定条件 | 未知の第5値が将来増えても過剰警告側に倒れる＝**fail-safe**。安全 |
| `amendment_scheduled_enforcement_date` の意味 | 「今の版を生んだ改正の**暫定**施行日」。現行版取得では原則 null（probe 2件とも null）。**将来の未施行改正では"ない"** |
| 本文（law_full_text）と revision_info の版一致 | 素の lawId 取得は常に現行施行版を返し、本文＝revision_info＝現行版で**常に整合** |
| `remain_in_force` | 労基法（現に有効）で `false`。**通常値であり廃止信号ではない**。警告トリガに使わない |
| **版固定 URL** | `GET https://laws.e-gov.go.jp/api/2/law_data/{law_revision_id}` が **HTTP 200**。素の `/law/{lawId}` が常に現行版へ解決するのに対し、版を一意固定できる |
| search 系（`/laws`）の revision_info | 実は同梱される。v1 で search を対象外にするのは「データが無いから」ではなく純粋なスコープ選択 |

> 注記（確度）: 「現行版取得で `amendment_scheduled_enforcement_date` が非 null になる法令は絶対に無い」までは網羅検証していない。施行期日が政令委任の現行版で稀に暫定値が残る可能性は排除しきれないため、v1 はこのフィールドを**参照しない**設計とし、判断の依存を避ける。

## 4. データ経路（plumbing）

```text
egov API law_data.revision_info（既に raw JSON で取得済み・lawDataRawCache 通過）
  └→ types.ts: EgovLawData に revision_info?（防御的に全 optional/nullable）を追加  … 型宣言のみ
      └→ source-adapters/egov-source-adapter.ts: 変更不要（raw を素通し）
      └→ law-service.ts: GetLawArticleResult / GetLawTocResult に revisionInfo?（camelCase）を追加
          │   getLawArticle / getLawToc が data.revision_info から populate（NormalizedCache に載る）
          ├→ get-article.ts             ─┐  pure helper 3本＋enum 和訳マップを共有
          └→ evidence-bundle-service.ts  ─┘  （primary_evidence ＋ 委任先 toc evidence）
```

- **adapter 変更不要**: [egov-source-adapter.ts](../../../src/lib/source-adapters/egov-source-adapter.ts) は `fetchJson<EgovLawData>` / `JSON.parse(cached)` を丸ごと返すだけでフィールド写像をしていない。型に `revision_info?` を足すだけで通る。
- **キャッシュ整合**: revision は per-law。既に版依存メタ（`lawNum`/`promulgationDate`）を同じ payload に載せており、同一 law・同一時点で同一 revision に収束、TTL（law_article 15分）が同一境界で staleness を縛る。**cache key 変更は不要**。
- **`EgovLawData.revision_info` の型**: v1 で使うフィールドのみモデル化（他は将来拡張）。すべて `?: string | null` として防御的にパース。

```ts
// src/lib/types.ts（EgovLawData に追加）
revision_info?: {
  law_revision_id?: string | null;
  amendment_enforcement_date?: string | null;      // 現行版の施行日
  amendment_enforcement_comment?: string | null;   // 一部施行等の但し書き
  amendment_law_num?: string | null;
  amendment_law_title?: string | null;
  amendment_law_id?: string | null;
  current_revision_status?: string | null;         // CurrentEnforced 等（enum 固定しない）
  repeal_status?: string | null;                   // None 等
  repeal_date?: string | null;
};
```

## 5. 出力コントラクト

### 5.1 構造化フィールド `revision_metadata`（新規）

`get_article.data`（[get-article.ts の outputSchema](../../../src/tools/get-article.ts#L24-L40)）と `EvidenceRecord`／bundle の共有 `evidenceSchema`（[get-evidence-bundle.ts:27-56](../../../src/tools/get-evidence-bundle.ts#L27-L56)）に **egov 専用 optional** で追加。既存の `article_locator?`（egov 専用）・`date?`/`number?`（mhlw/jaish 専用）と同型の "wide record" 方式。mhlw/jaish 生成経路では**付与しない**（undefined のまま）。1行コメントで egov 専用を明示。

```ts
revision_metadata?: {
  law_revision_id?: string;            // 版の一意ID（再現性アンカー）
  current_enforcement_date?: string;   // = amendment_enforcement_date（ISO・null→undefined 正規化）
  enforcement_note?: string;           // = amendment_enforcement_comment（一部施行等の但し書き。非null時のみ）
  amendment_law_num?: string;          // 改正法番号（和暦）
  amendment_law_title?: string;        // 改正法名（人間可読文字列からはここへ退避）
  current_revision_status?: string;    // passthrough・z.string()（未知 enum 値に安全）
  repeal_status?: string;              // passthrough
  version_pinned_url?: string;         // https://laws.e-gov.go.jp/api/2/law_data/{law_revision_id}（版固定・実測200）
}
```

- **命名**: 人間可読 `version_info`(string) との混同を避け、API 由来 `revision_info` と対応する `revision_metadata` を採用。内部フィールドは既存 snake_case 規約（`source_type`/`retrieved_at`）に一致。
- **null 正規化（C1）**: API は `null` を返し得るが zod の `.optional()` は `null` を弾く。helper で **`null`/空文字 → `undefined`** に正規化してから載せる。これを怠ると最も普通の法令で outputSchema validation が実クライアントで失敗する。
- **`z.string()` を維持**（enum 固定しない）: `current_revision_status`/`repeal_status` は未知値でも validation error にしない。
- `version_pinned_url` は `law_revision_id` 存在時のみ導出。素の `source_url`（`/law/{lawId}`）は人間閲覧用で常に現行版に解決するため据え置き、版固定は本フィールドが担う。

### 5.2 人間可読 `version_info`（string）強化

既存 base 形式 `joinVersionInfo([lawNum, promulgationDate])`（＝`法令番号 / 公布日`）は**変えず**、末尾に施行日セグメントを **append** する。**改正法名・改正法番号は文字列に載せない**（§7 誤帰属対策・構造化側のみ）。現行版施行日＋明示 hedge のみ：

```text
昭和二十二年法律第四十九号 / 1947-04-07 / 現行版の施行日 2026-06-24　※この施行日は法令全体の現行版を指し、引用した条文が改正されたとは限りません
```

- append-only ゆえ既存 base は不変。既存テストの `toContain('昭和')`（[tests/tool-wire-contract.test.ts:211](../../../tests/tool-wire-contract.test.ts#L211)）は先頭に法令番号が残るため通過。
- 施行日は **ISO 固定**。freshness の `formatJstDate`（[freshness-warnings.ts:29](../../../src/lib/indexes/freshness-warnings.ts#L29)）は**流用しない**——施行日は法的暦日でありタイムスタンプではないため `" JST"` を付けてはならない。
- `revision_info` が無い／施行日が取れない場合は施行日セグメント（hedge 含む）ごと省略し、既存の `法令番号 / 公布日` 形式へ **graceful degrade**。

### 5.3 警告 `LAW_NOT_CURRENTLY_ENFORCED`

**複合トリガ**（`current_revision_status` 単独では廃止を取りこぼす）:

```
current_revision_status が {undefined, 'CurrentEnforced'} 以外   （UnEnforced / PreviousEnforced / Repeal）
 または
repeal_status が {undefined, 'None'} 以外                        （Repeal / Expire / Suspend / LossOfEffectiveness）
```

`remain_in_force` は**トリガに含めない**（一次証拠：現行法でも `false` ＝正常値）。

状態別の日本語文言（既存トーン＝です・ます／事実→行動、`repeal_status` を優先評価）:

| 判定 | 文言 |
|---|---|
| `repeal_status=Repeal` or `current_revision_status=Repeal` | この法令は廃止されています{（廃止日: repeal_date）}。現に効力を有しません。現行の法令を確認してください。 |
| `repeal_status=Expire` | この法令は期間満了により失効しています{（失効日: repeal_date）}。現に効力を有しません。 |
| `repeal_status=LossOfEffectiveness` | この法令は効力を喪失しています。現に効力を有しません。 |
| `repeal_status=Suspend` | この法令は効力が停止されています。適用の可否を確認してください。 |
| `current_revision_status=UnEnforced` | この版はまだ施行されていません（未施行）。現在の施行版とは内容が異なる可能性があります。 |
| `current_revision_status=PreviousEnforced` | この版は過去の施行版であり、現行版ではありません。より新しい施行版が存在します。 |

- **enum の raw 英語値は warning 文言に出さない**。和訳マップをコード定数として持つ（構造化メタ側は raw を保持）:
  - `current_revision_status`: CurrentEnforced→現行施行版 / UnEnforced→未施行 / PreviousEnforced→過去施行版 / Repeal→廃止
  - `repeal_status`: None→該当なし / Repeal→廃止 / Expire→失効 / Suspend→効力停止 / LossOfEffectiveness→効力喪失
- **bundle での可視性（m5）**: warning message に**法令名を含める**（top-level に集約されても「どの法令か」が消えないように）。
- 時刻非依存: v1 の唯一の警告は文字列一致のみで日付比較を含まない。`now` 注入は不要。

## 6. 実装ユニット

### 6.1 pure helper（[src/lib/evidence-metadata.ts](../../../src/lib/evidence-metadata.ts) に集約）

現状 18行（`computeUpstreamHash`/`joinVersionInfo`）に純粋関数を追加。**純粋厳守**（`NormalizedCache` は参照返し＝[cache.ts:53](../../../src/lib/cache.ts#L53)。`result.revisionInfo` を mutate すると全 consumer のキャッシュを汚染する。読み取り→新値返却のみ）。

- `buildRevisionMetadata(revisionInfo?): RevisionMetadata | undefined`
  - `null`/空文字を `undefined` に正規化。全フィールド欠落なら `undefined` を返す。
  - `law_revision_id` から `version_pinned_url` を導出。
  - **API 名→出力名の写像はこの関数内にコメント表で固定**（`current_enforcement_date ← amendment_enforcement_date` 等の mis-map を防ぐ）。
- `buildVersionInfoString(lawNum, promulgationDate, revisionInfo?): string | undefined`
  - トップレベル ` / ` 連結は既存 `joinVersionInfo` を再利用。
  - 施行日セグメントは施行日が取れる時のみ付与＋ hedge。改正法名は載せない（誤帰属対策）。
  - 入れ子の空値も個別ガード（`（による改正）` 空括弧混入を防ぐ／v1 は改正法名を文字列に出さないため実質回避されるが、helper 契約として明記）。
- `getRevisionWarnings(revisionInfo?): WarningMessage[]`
  - §5.3 の複合トリガ＋和訳マップ。`revisionInfo` 欠落時は空配列。`now` を取らない（純粋）。

### 6.2 `law-service.ts`

`GetLawArticleResult` / `GetLawTocResult` に `revisionInfo?`（camelCase・生の revision_info 部分集合）を追加し、`getLawArticle`（[126-137](../../../src/lib/services/law-service.ts#L126-L137)）/`getLawToc`（[159-168](../../../src/lib/services/law-service.ts#L159-L168)）で `data.revision_info` から populate。

### 6.3 `get-article.ts`

- `data.revision_metadata = buildRevisionMetadata(result.revisionInfo)`
- `version_info = buildVersionInfoString(result.lawNum, result.promulgationDate, result.revisionInfo)`
- `envelope.warnings = [...freshnessWarnings, ...getRevisionWarnings(result.revisionInfo)]`
- outputSchema に `revision_metadata`（optional object）を追加。`createToolEnvelopeSchema` は非 strict ＆ additive ゆえ後方互換。

### 6.4 `get_evidence_bundle`（primary ＋ 委任先 toc）

- `EvidenceRecord`（[evidence-bundle-service.ts:9-31](../../../src/lib/services/evidence-bundle-service.ts#L9-L31)）と `evidenceSchema` に `revision_metadata?` を追加。
- primary evidence（[77](../../../src/lib/services/evidence-bundle-service.ts#L77)）と委任先 toc evidence（[113](../../../src/lib/services/evidence-bundle-service.ts#L113)）で同 helper を通し version_info／revision_metadata を統一。
- **警告経路**: revision warning はサービス側 top-level `warnings` 配列（[:97](../../../src/lib/services/evidence-bundle-service.ts#L97)）へ push → 既存 `dedupeWarnings` → [get-evidence-bundle.ts:100/111](../../../src/tools/get-evidence-bundle.ts#L100) の mergedWarnings → envelope.warnings + data.warnings + text section。per-record `warnings`（primary は `[]` 固定）だけに載せると human-readable text も dedupe も top-level しか読まず**不可視**になるため主経路は top-level。

### 6.5 意図的な非対象（M4 を「見落とし」でなく「宣言」に）

`diff_revision`（[diff-revision-service.ts:120](../../../src/lib/services/diff-revision-service.ts#L120)、版比較で version 意味論が異なる）・deprecated `get_law`（[get-law.ts](../../../src/tools/get-law.ts)、明示フィールド列挙で result を spread せず schema 不変・余剰フィールドは無害に無視）は v1 対象外。`buildVersionInfoString` は revision 無しで graceful degrade するため、将来の取り込みは低コスト。

### 6.6 companion fix（[freshness-warnings.ts:68](../../../src/lib/indexes/freshness-warnings.ts#L68)）

`BUNDLED_INDEX_AGED` の文言後半を平易化＋過大約束是正（本文は常に live 取得ゆえ本文更新に再起動不要／再起動が対象とするのは内蔵の法令リスト＝法令名・略称→法令特定の対応表）:

> `…なお条文の本文は常に最新の現行版をオンライン取得するため、本文の更新に再起動は不要です。この警告が対象とするのは内蔵の法令リスト（法令名・略称から法令を特定するための対応表）で、新しく制定・改称された法令を検索できるようにするには Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動なら再起動で最新パッケージを自動取得。グローバルインストールは \`npm update -g jp-labor-evidence-mcp\`）。`

## 7. 監査信頼性の設計判断（誤帰属の回避）

`get_article` は単一条文を返すが、`revision_info` は**法令全体の現行版**を生んだ改正を指す。整備法（例「令和八年法律第四十六号 民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律」）は当該条を触っていない蓋然性が高い。近接バイアス＋公式名称の権威性により、社労士が「引用条がこの日付に改正された」と書面へ誤転記するリスク（Critical）を避けるため:

1. 改正法名（`amendment_law_title`）を人間可読 `version_info` 文字列から**撤去**し `revision_metadata` のみに置く。
2. 施行日には**明示 hedge**「※この施行日は法令全体の現行版を指し、引用した条文が改正されたとは限りません」を付す。
3. 一部施行の但し書き（`enforcement_note`）を保持し、日付の裸の断定を避ける。

## 8. テスト戦略（TDD）

- **pure helper 単体**（evidence-metadata）: `buildRevisionMetadata`（null/空正規化・version_pinned_url 導出・全欠落→undefined）／`buildVersionInfoString`（hedge・施行日欠落 degrade・改正法名を出さないこと）／`getRevisionWarnings`（複合トリガの各状態・None は無警告・欠落は空）。
- **law-service**: `revision_info` 入り fixture から `GetLawArticleResult.revisionInfo` が populate されること。
- **get_article real-server 統合テスト（新設・C1 の盲点封じ）**: `callTool`（[tests/test-helpers/mcp-internals.ts](../../../tests/test-helpers/mcp-internals.ts) の `callTool`）で実サーバ経由呼び出しし、(a) `revision_info` あり fixture で `revision_metadata` と強化 version_info を検証、(b) `amendment_enforcement_date: null` を含む fixture で **outputSchema validation が通る**こと（null→undefined 正規化の回帰防止）、(c) `repeal_status: Repeal` fixture で `LAW_NOT_CURRENTLY_ENFORCED` 発火。※ 現状 get_article/get_evidence_bundle/diff_revision は real-server 経由テストが皆無のため、この盲点を塞ぐ。
- **evidence-bundle 結合**: primary_evidence の `revision_metadata`＋top-level warning。
- **companion fix**: [tests/freshness-warnings.test.ts](../../../tests/freshness-warnings.test.ts) の `BUNDLED_INDEX_AGED` 文言 assertion 更新。
- **fixture**: [tests/fixtures/egov/labor-standards-law.json](../../../tests/fixtures/egov/labor-standards-law.json) に `revision_info` ブロックを追加（実形状は §3）。not-enforced/repealed 系は別 fixture もしくは inline で用意。

## 9. リリース

- wire contract の additive 追加（optional フィールド＋新警告 code）＝ **minor bump 相当**。
- 現行 v0.5.0 は据え置き・`[Unreleased]` に deps bump（Node>=24 系）が滞留中。本機能は次 minor に相乗り出荷（単独 patch を切らない方針を踏襲。version bump は実装完了時に別途判断）。
- **CHANGELOG**: 実装 PR で `[Unreleased]`（または bump 時の実日付付き節）に追記。

## 10. レビュー台帳（5視点サブエージェント）

| 出所 | 深刻度 | 指摘 | 処理 |
|---|---|---|---|
| 一次証拠 | Critical | 未施行 warning の前提（`amendment_scheduled_enforcement_date`）が誤読。真の検知は別エンドポイント要 | **v1 から除外**（§2 非目標） |
| 契約 | Critical(C1) | `null` を `z.string().optional()` が弾く＋get_article は real-server テスト皆無 | null 正規化（§5.1）＋real-server 統合テスト（§8） |
| ドメイン | Critical | 単一条文への法令全体の改正帰属＝誤転記リスク | 改正法名を文字列から撤去＋hedge（§7） |
| ドメイン | Major | 廃止・失効は `repeal_status` に出る。`current_revision_status` 単独では取りこぼす | 複合トリガ（§5.3） |
| ドメイン | Major | 一部施行の但し書き（`amendment_enforcement_comment`）を落とすと日付を誤断定 | `enforcement_note` 保持（§5.1/§7） |
| 契約/アーキ | Major(M4) | helper が egov version_info 全サイトを覆わず書式割れ（特に diff_revision） | 対象を宣言（§6.5）・helper は degrade 対応 |
| アーキ | Major | `getRevisionWarnings` の時刻非依存は要検討（兄弟は now 注入） | 未施行除外で日付比較が消え、v1 は真に時刻非依存（§5.3） |
| スコープ/ドメイン | Minor | `source_url` は版を固定しない | `version_pinned_url`＋`law_revision_id`（§5.1・実測200） |
| 契約 | Minor(M3) | 入れ子文字列が `joinVersionInfo` の空値ガード外 | helper 個別ガード（§6.1） |
| アーキ | Minor | cache 参照返し→helper mutate 汚染 | 純粋厳守（§6.1） |
| ドメイン | Minor | 施行日への `" JST"` 付与は誤り／「解決マップ」は内部語 | ISO 固定・JST 付けない（§5.2）／companion fix 平易化（§6.6） |
| ドメイン | Minor(不採用) | `remain_in_force === false` もトリガに | **不採用**（現行法でも false＝正常。§3/§5.3） |
| 一次証拠 | 情報 | search 系にも revision_info あり | v1 は純スコープ選択として対象外（§2） |

## 11. 未解決事項

- なし（v1 スコープは確定）。v2 候補は「未施行改正検知（`/law_revisions`）」「和暦併記」「diff_revision への波及」「廃止フル UX」で、backlog メモに残す。
