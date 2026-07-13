# e-Gov 未施行改正の検知（get_article opt-in）— 設計仕様 v2

- 日付: 2026-07-13
- ステータス: **Draft（brainstorming 完了・マルチパースペクティブレビュー → user review 待ち）**
- 位置づけ: [2026-07-13-egov-revision-version-info-design.md](2026-07-13-egov-revision-version-info-design.md)（v1・現行版表示、PR #31 で merge 済み）の **v2**。v1 で「別エンドポイント `/law_revisions` を要するため非目標」とした未施行改正検知を実装する。
- 関連: v1 spec §2「非目標」、backlog メモ [2026-07-13-egov-revision-version-info-backlog.md](2026-07-13-egov-revision-version-info-backlog.md)

## 1. 動機（監査ストーリーの完成）

v1 は「今引いた条文が**いつ施行の現行版**か」を Evidence に載せた。しかし社労士の監査では「この法令に**これから施行される改正が控えているか**」——未施行改正のロードマップ——が同等に重要。育児介護休業法・労働施策総合推進法・安衛法など、労働法令には未施行改正が実在かつ豊富にある（§3）。v1（現行版）＋ v2（控えている改正）で監査ストーリーが完成する。

未施行改正の検知は現行版取得（`law_data`）では**不可能**（§3 の一次証拠）で、別エンドポイント `/law_revisions` の追加リクエストを要する。ゆえに v1 の「追加リクエストゼロ」原則はここでは成立せず、v2 は**明示的な opt-in**（追加コストを利用者が選ぶ）で導入する。

## 2. スコープ（v2 = get_article opt-in のみ）

**含む**:
- `get_article` に入力 `include_pending_amendments`（既定 **false**）を追加。true のときのみ `/law_revisions` を追引きし、未施行改正を検知
- 構造化 `pending_amendments[]`（施行日昇順の全ロードマップ）＋ 概要警告 `UNENFORCED_AMENDMENT_PENDING` ＋ text 節
- `/law_revisions` 失敗時の graceful degradation（条文は返す）

**非目標（別スコープ / 別 v2 項目）**:
- `get_evidence_bundle` への統合（bundle は既に多リクエスト・意図的な**次の follow-up**）
- 改正法ごとのグループ化（段階施行を「改正法Xのn期施行」とまとめる提示）
- 和暦併記（別 v2 項目・元号変換 util）
- 過去版・未施行版の**本文**取得（時点法令。別途）
- 人間可読 `version_info`(string) の変更（v1 の現行版表示のまま据え置き。未施行ロードマップは構造化＋警告＋text 節へ）

## 3. 一次証拠（2026-07-13 に live API＋公式 OpenAPI で確認）

一次ソース:
- `GET https://laws.e-gov.go.jp/api/2/law_revisions/{law_id_or_num}`（labor 各法で実測）
- 公式 OpenAPI: `https://laws.e-gov.go.jp/api/2/swagger-ui/lawapi-v2.yaml`（`operationId: get-revisions`「法令履歴一覧取得API」）

確認済み事実:

| 事項 | 確認結果 |
|---|---|
| エンドポイント実在 | ✓ HTTP 200・JSON（`Accept: application/json`、`response_format` 不要）。`law_id` でも `law_num` でも可 |
| レスポンス形状 | `{ law_info, revisions[] }`。各 `revisions[]` 要素は v1 の `revision_info` と**同一フィールド集合**。`law_revision_id` の**新しい順**（降順） |
| **ページングなし** | 1 リクエストで全版取得（労基法13件・安衛法19件を1コール・~10KB）。`law_id あたり1リクエスト` |
| サーバサイドフィルタ | `?current_revision_status=UnEnforced` が機能（検知だけなら最小ペイロード） |
| `current_revision_status` enum | `CurrentEnforced` / `UnEnforced` / `PreviousEnforced` / `Repeal`（閉じた4値） |
| **未施行版は労働法令に豊富** | 安衛法5件・育介法/労働施策総合推進法/短時間有期/雇用保険法/均等法/労基法 各1件（`UnEnforced` フィルタで実測） |
| **1改正法が複数 UnEnforced 版を生む（段階施行）** | 安衛法: 令和七年法律第三十三号の一改正で **5施行日**（2026-10-01 / 2027-01-01 / 2027-04-01 / 2028-04-01 / 2030-04-01）。「未施行版は高々1件」は**誤り** |
| 施行予定日の信頼できるフィールド | **`amendment_enforcement_date`（required・常に埋まる）**。`amendment_scheduled_enforcement_date` は他法令連動時のみの補助（原則 null） |
| CurrentEnforced 版 == law_data の revision_info | ✓ 完全一致（`law_revision_id` 一致）。v1 の前提と整合 |
| 404 | 存在しない law_id は HTTP 404（`{"code":"404001",...}`）。既存 `HttpSourceAdapter` は `!ok` で throw |
| rate-limit | OpenAPI に記載なし（不明）。既存 `EgovSourceAdapter`（`minIntervalMs:200`/`maxConcurrency:1`/circuit breaker）を共有すれば安全側 |

> 注記（確度）: `amendment_scheduled_enforcement_date`/`amendment_enforcement_comment` が「他法令連動時のみ埋まる」はサンプル1件からの帰納で公式明言なし。v2 は施行予定日に **`amendment_enforcement_date`（required）** を用いるため、この不確実性に依存しない。

## 4. データ経路

```text
get_article（include_pending_amendments=true のとき）
  └→ law-service.getPendingAmendments(lawId)
      └→ egov-client.fetchLawRevisions(lawId)
          └→ egovSourceAdapter.fetchLawRevisions(lawId)   … 既存 fetchLawDataById と同型
              └→ GET /api/2/law_revisions/{lawId}（unfiltered・lawRevisionsRawCache 経由）
      └→ buildPendingAmendments(revisions)   … UnEnforced 抽出→昇順→map（pure）
```

- **unfiltered 取得**：`?current_revision_status=UnEnforced` フィルタは使わず全版を取得してキャッシュ（payload ~10KB と軽量ゆえ、raw cache 1本を将来の他用途にも再利用可能にする）。`UnEnforced` 抽出は client 側 helper で行う。
- **adapter 変更**：`fetchLawRevisions(lawId)` を追加（既存 `fetchLawDataById` と同型：cache→未ヒットで `fetchJson`→`MAX_CACHEABLE_JSON_CHARS` 以下ならキャッシュ）。rate-limit/circuit-breaker は同一 adapter インスタンスで自動共有。
- **cache**：`cache.ts` に `lawRevisionsRawCache = new RawResponseCache<string>('law_revisions', { defaultTtlMs: 60*60*1000, maxEntries: 64, maxBytes: 2_000_000 })`（`lawDataRawCache` と同パターン・TTL 1時間）。
- **型**（`types.ts`）：
  ```ts
  export interface EgovLawRevisionsResponse {
    law_info?: EgovLawData['law_info'];      // 改正非依存の法令メタ（本 feature では未使用でも防御的に）
    revisions?: EgovRevisionInfo[];          // v1 の EgovRevisionInfo を再利用（各版）
  }
  ```

## 5. 出力コントラクト

### 5.1 入力（get_article）

`getArticleInputSchema` に追加:

```ts
include_pending_amendments: z.boolean().optional().describe(
  '未施行の改正（施行予定日つき）を検知して pending_amendments に載せる。' +
  '別途 e-Gov /law_revisions を1回追引きするため既定 false。監査時のみ true 推奨。'
),
```

### 5.2 構造化 `pending_amendments`（新規・施行日昇順）

`get_article.data` に **optional** で追加（param=true 時のみ present。未施行なしなら `[]`）:

```ts
pending_amendments?: Array<{
  enforcement_date: string;       // = amendment_enforcement_date（required・ISO）
  amendment_law_num?: string;
  amendment_law_title?: string;
  law_revision_id?: string;
  version_pinned_url?: string;    // https://laws.e-gov.go.jp/api/2/law_data/{law_revision_id}
  enforcement_note?: string;      // = amendment_enforcement_comment（他法令連動時のみ）
}>;
```

- 共有 zod `pendingAmendmentSchema` を `tool-contract.ts` に定義（v1 の `revisionMetadataSchema` と同じ置き場）。`enforcement_date` のみ required、他は optional。
- null/空正規化は helper（v1 の `cleanValue` 再利用）。
- 昇順ソートは `enforcement_date`（ISO 文字列の辞書順＝時系列順）。

### 5.3 警告 `UNENFORCED_AMENDMENT_PENDING`（概要・簡潔）

未施行版が1件以上のとき、`envelope.warnings` に付与（**法令名接頭**・件数＋最も近い施行予定日）:

> `労働安全衛生法: 未施行の改正が 5 件あります（最も近い施行予定日 2026-10-01）。詳細は pending_amendments を参照してください。`

- 全ロードマップは `pending_amendments` と text 節に委ね、警告文は簡潔に保つ。
- 時刻非依存：`current_revision_status==='UnEnforced'`（e-Gov が施行済みを CurrentEnforced/PreviousEnforced へ遷移させる）に依拠し、`now` と施行日を比較しない。

### 5.4 text 応答

param=true かつ未施行ありのとき、markdown text に節を追記:

```text
## 未施行の改正（5 件）
1. 2026-10-01 施行予定 — 令和七年法律第三十三号「労働安全衛生法及び作業環境測定法の一部を改正する法律」
2. 2027-01-01 施行予定 — （同上）
...
```

人間/LLM が読む本文にも監査情報を surface する。

### 5.5 Graceful degradation（重要）

`/law_revisions` の失敗（ネットワーク・404・parse）は **get_article を失敗させない**（条文は v1 どおり返す）:
- `envelope.degraded = true`、`partial_failures[]` に `{ source: 'egov', target: 'law_revisions:{lawId}', reason }` を記録
- 警告 `PENDING_AMENDMENT_CHECK_FAILED`（法令名つき「未施行改正の確認に失敗しました…」）を付与
- `pending_amendments` は省略（undefined）
- `status` は `'ok'` を維持（主成果＝条文は完全に返るため。get_evidence_bundle の `'partial'` とは異なり、get_article の主 deliverable は単一条文で、それは成功している）

## 6. 実装ユニット

### 6.1 pure helper（`src/lib/evidence-metadata.ts`）

v1 の `cleanValue`（null/空→undefined）を再利用。純粋厳守（引数 mutate 禁止）。

- `buildPendingAmendments(revisions: EgovRevisionInfo[] | undefined): PendingAmendment[]`
  - `revisions` が無ければ `[]`。
  - `current_revision_status === 'UnEnforced'` を抽出。
  - 各版を `PendingAmendment` に map（`enforcement_date = cleanValue(amendment_enforcement_date)`。**enforcement_date が取れない版は除外**——required だが防御的に）。`version_pinned_url` は `law_revision_id` から導出（v1 と同一 URL 生成——共通化を検討）。
  - `enforcement_date` 昇順ソート。
- `getPendingAmendmentWarnings(pending: PendingAmendment[], lawTitle: string): WarningMessage[]`
  - 空なら `[]`。1件以上なら `UNENFORCED_AMENDMENT_PENDING`（§5.3 の文言・`pending[0].enforcement_date` が最も近い）。

### 6.2 `egov-client.ts` / `egov-source-adapter.ts` / `cache.ts`
§4 のとおり `fetchLawRevisions(lawId)` と `lawRevisionsRawCache` を追加。

### 6.3 `law-service.ts`
```ts
export async function getPendingAmendments(lawId: string): Promise<PendingAmendment[]> {
  const { revisions } = await fetchLawRevisions(lawId);
  return buildPendingAmendments(revisions);
}
```
（`PendingAmendment` 型は `types.ts` に定義し law-service/helper/tool で共有）

### 6.4 `get-article.ts`
- input schema に `include_pending_amendments` を追加。
- handler：条文取得後、`args.include_pending_amendments === true` のときのみ:
  ```ts
  try {
    const pending = await getPendingAmendments(result.lawId);
    // data.pending_amendments = pending; warnings に getPendingAmendmentWarnings(pending, result.lawTitle) を merge;
    // text 節を追記
  } catch (error) {
    // degraded=true; partial_failures に記録; PENDING_AMENDMENT_CHECK_FAILED 警告
  }
  ```
- outputSchema に `pending_amendments: z.array(pendingAmendmentSchema).optional()` を追加。
- 既存の freshness/revision 警告（v1）とは独立に merge。

## 7. テスト戦略（TDD）

- **pure helper 単体**（evidence-metadata）: `buildPendingAmendments`（複数 UnEnforced の昇順・CurrentEnforced/PreviousEnforced/Repeal 除外・空→[]・enforcement_date 欠落版の除外・version_pinned_url 導出）／`getPendingAmendmentWarnings`（空→無警告・件数＋最近施行日・法令名接頭）。
- **adapter**: `fetchLawRevisions` を fetch stub で（`law_revisions` fixture・cache ヒットで2回目 fetch なし）。
- **law-service**: fixture（安衛法型の 5 UnEnforced＋CurrentEnforced＋PreviousEnforced）から `getPendingAmendments` が 5 件を昇順で返す。
- **get_article 統合**（`callTool` 経由・実 outputSchema 検証）:
  - `include_pending_amendments` 省略/false → `/law_revisions` を引かない（fetch 呼ばれない）・`pending_amendments` undefined。
  - true → `pending_amendments` 5件＋`UNENFORCED_AMENDMENT_PENDING` 警告＋text 節。
  - **degrade**: `/law_revisions` が失敗（fetch reject/404）しても条文は返り、`degraded=true`＋`partial_failures`＋`PENDING_AMENDMENT_CHECK_FAILED` 警告、`pending_amendments` は undefined。
  - 未施行なし（全 CurrentEnforced の fixture）で true → `pending_amendments: []`・警告なし。
- **fixture**: `tests/fixtures/egov/law-revisions-*.json`（複数 UnEnforced の安衛法型・未施行なしの単純型）。

## 8. リリース
wire contract の additive 追加（input optional bool・output optional array・新警告 code）＝ **minor bump 相当**。version は次 minor 相乗り（v1 と同様）。CHANGELOG `[Unreleased]` に追記。

## 9. レビュー台帳
（マルチパースペクティブレビュー後に追記）

## 10. Open questions（レビュー論点）
- degrade 時の `status`：`'ok'`（主成果は完全）で妥当か、`'partial'` にすべきか（get_evidence_bundle は partial）。
- `pending_amendments` の件数上限（安衛法5件程度。多数版の法令で上限クリップが要るか——現状 unbounded）。
- `version_pinned_url` 生成ロジックの v1（`buildRevisionMetadata`）との共通化（重複を避けるヘルパ抽出）。
- `include_pending_amendments` を将来 `get_evidence_bundle` にも広げる際の一貫性（本 spec は get_article 限定）。
