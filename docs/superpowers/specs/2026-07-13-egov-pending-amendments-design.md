# e-Gov 未施行改正の検知（get_article opt-in）— 設計仕様 v2

- 日付: 2026-07-13
- ステータス: **5視点レビュー統合済み（user review 待ち）**
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
- 人間可読 `version_info`(string) の変更（v1 の現行版表示のまま据え置き。未施行ロードマップは構造化 `pending_amendments`＋警告の2層へ。text 節は追加しない・§5.4）

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
| **1改正法が複数 UnEnforced 版を生む（段階施行）** | 安衛法: 令和七年法律第三十三号の一改正で **5施行日**（2026-10-01〜2030-04-01）。「未施行版は高々1件」は**誤り**。件数は法令により多い——**健保法15件**（2026-08-01〜2029-10-01・3年超）／厚年法12・国保法12・船員保険法11・介護保険法10 |
| 施行予定日フィールド | `amendment_enforcement_date` を用いる。**required 保証はない**——OpenAPI に `required` 記載が一切なく（全 field 形式上 optional）、同一 `law_revision_id` が `/law_data` 経由では null を返す実例あり（国家情報会議設置法・政令委任の施行日）。`/law_revisions` 経由では全サンプル（112 UnEnforced）非 null だったが**契約保証ではない**。→ 防御的に **enforcement_date 欠落版は除外**し、除外時は fail-safe 警告を出す（§5.5） |
| 日付形式 | 全 1,049 サンプルで厳密 ISO `YYYY-MM-DD`（和暦混入なし）。**辞書順ソート＝時系列順**が成立。ただし同日複数 UnEnforced（安衛規則4件が 2027-04-01 同日・別省令）があり、tie は第2キー `law_revision_id` で決定的化する（§6.1） |
| **版固定 URL は UnEnforced 版でも有効**（実測 2026-07-13） | `GET /api/2/law_data/{UnEnforced の law_revision_id}` → **HTTP 200**（`law_full_text` 付き＝未来版の本文が引ける）。`version_pinned_url` を pending 各件に付与して良い |
| 抽出ロジック（status==='UnEnforced'） | 1,049 サンプルで過不足なし（Repeal/PreviousEnforced/CurrentEnforced は漏れない）。廃止済み法令は最終版が status `Repeal` になり UnEnforced は残らない。ただし **UnEnforced 版に `repeal_status != 'None'`（廃止予定）や `mission:'New'`（初制定・`amendment_law_*` が null）が混じり得る**——「改正」一律扱いは誤ラベル risk（§5.2/§5.3） |
| CurrentEnforced 版 == law_data の revision_info | 概ね一致だが**例外あり**：登録40法令中 **4法令（労組法・厚年法・国保法・社労士法）は `/law_revisions` に CurrentEnforced 版が存在せず**、現行版が `PreviousEnforced` タグ。v2 の UnEnforced 抽出には無影響だが、v1 の `LAW_NOT_CURRENTLY_ENFORCED`（/law_data 単一 revision_info を読む）の follow-up 論点（§9 台帳） |
| 404 | 存在しない law_id は HTTP 404（`{"code":"404001",...}`）。空履歴は `{law_info, revisions:[]}` を 200 で返す（40法令中 空は皆無・最低1版） |
| rate-limit / circuit breaker | OpenAPI に rate-limit 記載なし（不明）。**circuit breaker の cross-endpoint 波及は非問題**：[http-source-adapter.ts:121](../../../src/lib/source-adapters/http-source-adapter.ts#L121) の `recordSuccess()` が成功毎に `consecutiveFailures=0` にリセットし、get_article は必ず law_data（成功）を先に引くため、後続 law_revisions 失敗は threshold(3) に蓄積しない（3連続失敗＝e-Gov 全体障害時のみ開き、それは正しい保護）。adapter 改修不要 |

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
  '別途 e-Gov /law_revisions を1回追引きするため既定 false。' +
  'false／省略時は未施行改正の有無を確認しない（「改正予定なし」を意味しない）。' +
  '就業規則改定・compliance 監査など改正リスクを確認する場面で true を指定。'
),
```

あわせて get_article の **tool 本体 description**（現状「確定済み law_id に対して、特定条文を厳密に取得する。resolve_law の後段で使用する。」）にも一言追記し、field description を読み飛ばす LLM 経路でも「未確認≠改正なし」が伝わるようにする: 「…未施行の改正確認は既定で行わない（`include_pending_amendments: true` 指定時のみ）。」（Domain/Scope 視点の opt-in 発見性リスクへの緩和）

### 5.2 構造化 `pending_amendments`（新規・施行日昇順）

`get_article.data` に **optional** で追加（param=true 時のみ present。未施行なしなら `[]`）:

```ts
pending_amendments?: Array<{
  enforcement_date: string;       // = amendment_enforcement_date（ISO。欠落版は除外するので出力では常在）
  amendment_law_num?: string;
  amendment_law_title?: string;
  law_revision_id?: string;
  version_pinned_url?: string;    // /api/2/law_data/{law_revision_id}（UnEnforced 版でも 200・§3 実測）
  enforcement_note?: string;      // = amendment_enforcement_comment（他法令連動時等のみ）
  repeal_status?: string;         // passthrough。'None' 以外＝この版が「改正」でなく廃止/失効予定（§3）
}>;
```

- 共有 zod `pendingAmendmentSchema` を `tool-contract.ts` に定義（v1 の `revisionMetadataSchema` と同じ置き場）。`enforcement_date` のみ required、他は全 optional（`.string().optional()`）。**schema に `.max()` を付けない**——外部レスポンスが上限超過で validation error＝tool 全損になる footgun（最大観測15件と小さく、上限は不要。万一の pathological 法令は実装側 slice＋注記で対処）。
- null/空正規化は helper（v1 の `cleanValue`）を**全フィールドに**適用（`enforcement_date` だけでなく `repeal_status` 等も。1つでも素通りさせると v1 C1 型の null-validation-error 回帰）。
- **ソートは `enforcement_date` 昇順（ISO 辞書順＝時系列）、tie は第2キー `law_revision_id` 昇順**で決定的化（同日複数 UnEnforced が実在・§3）。
- **`repeal_status` / `mission:'New'` の含意**: UnEnforced 版に廃止予定（`repeal_status != 'None'`）や初制定（`mission:'New'`・`amendment_law_*` が null）が混じり得る。「改正」一律ラベルを避けるため `repeal_status` を passthrough し、警告文（§5.3）で「改正」の断定を hedge する。`mission:'New'` は登録法令（既存法令）では稀だが、`amendment_law_title` が空でも壊れない設計（全 optional）で吸収。

### 5.3 警告 `UNENFORCED_AMENDMENT_PENDING`（概要・hedge 付き）

未施行版が1件以上のとき、`envelope.warnings` に付与（**法令名接頭**・アンカー「現行施行版に対し」・件数＋最も近い施行予定日・**誤帰属 hedge**）:

> `労働安全衛生法: 現行施行版に対し、未施行の改正が 5 件予定されています（最も近い施行予定日 2026-10-01）。※これは法令全体の改正予定であり、引用した条文が改正対象に含まれるとは限りません。詳細は pending_amendments を参照してください。`

- **誤帰属回避（v1 §7 と同型・Critical 対応）**: 未施行改正は法令全体の将来版に対するもので、get_article で引いた単一条文がその改正で変わるとは限らない（安衛法の段階施行の多くは特定条のみ）。v1 が version_info に置いた hedge と同思想を warning に組み込む。アンカー「現行施行版に対し」は `LAW_NOT_CURRENTLY_ENFORCED`（引いた版が非現行）との混同も避ける。
- 全ロードマップ（全件・改正法名）は構造化 `pending_amendments` に委ね、警告文は簡潔＋hedge に保つ（**改正法名は warning 文に列挙しない**＝v1 の「改正法名は人間可読文字列に載せない」原則を踏襲）。
- **廃止予定の混在時**: `pending_amendments` に `repeal_status != 'None'` の版が含まれるとき「改正 N 件・廃止予定 M 件」と分けて数える（改正と廃止で社労士の対応が異なるため）。例: `…未施行の改正が 4 件・廃止予定が 1 件予定されています…`。
- **最も近い施行予定日は防御的に `min(enforcement_date)`** で算出（`pending[0]` に依存せず、helper 単体で未ソート入力を渡されても正しい）。
- 時刻非依存：`current_revision_status==='UnEnforced'`（e-Gov が施行済みを CurrentEnforced/PreviousEnforced へ遷移させる）に依拠し、`now` と施行日を比較しない。

### 5.4 text 応答 — 追加しない（構造化＋警告の2層に集約）

当初案の「## 未施行の改正」markdown 節は**設けない**（Scope 視点 Major）。理由:
- **SPEC.md §9.5「構造化レスポンスが正・表示テキストは二次生成物」に反する**——サーバが markdown 整形して重複表示するのは設計原則違反。
- **v1 前例と非対称**——実装済み get_article の text は `version_info`/`revision_metadata` を一切 text 化していない。同じ監査メタである pending だけ text 節を新設するのは自己矛盾。
- **三重表現（警告/構造化/text）の同期保守コスト**と、text 抜粋転記時の hedge 欠落・「（同上）」の意味喪失リスク（Domain 視点）。

警告（概要・hedge 付き §5.3）＋構造化 `pending_amendments`（全件 §5.2）の2層で監査要求を満たす。LLM は warnings＋pending_amendments から必要な文章を組み立てる（server instructions の役割分担どおり）。get_article の text テンプレートは v1 のまま不変。

### 5.5 Graceful degradation & fail-safe（重要）

**(a) `/law_revisions` 取得失敗**（ネットワーク・404・parse）は **get_article を失敗させない**（条文は v1 どおり返す）:
- **`status = partial_failures.length > 0 ? 'partial' : 'ok'`**（get_evidence_bundle の規約と統一）。Contract/Arch 視点 Major——`partial_failures` 非空＋`status:'ok'` は既存に前例がなく、observability の partials カウンタ（`recordToolCall` が `envelope.status` で加算）を素通りさせる。`isError` は 'invalid'/'unavailable' のみで決まるため 'partial' でも false 維持（条文は返る）。
- `degraded = true`、`partial_failures[]` に `{ source:'egov', target:'law_revisions:{lawId}', reason }` を記録。**reason を分類する**——egov 層は生 `Error` を投げる（`http-source-adapter.ts:73`）ため素直に受けると reason が `'Error'` になる。最小策は pending degrade の reason を `'upstream_unavailable'` に固定。望ましくは `egov-source-adapter` で `ExternalApiError`/`ParseError` にラップ（v1 の `mapErrorToEnvelope` の retryable 誤判定も同時に改善する companion fix・§9 台帳）。
- `observabilityRegistry.recordPartialFailure('egov', 1)` を呼ぶ（`mhlw`/`jaish` service の precedent と同型）。
- 警告 `PENDING_AMENDMENT_CHECK_FAILED`（法令名つき「未施行改正の確認に失敗しました…」）を付与。
- `pending_amendments` は省略（undefined）。

**(b) enforcement_date 欠落版の除外時**（§3・§5.2）: `buildPendingAmendments` が enforcement_date を持たない UnEnforced 版を除外したとき、**fail-safe 警告 `PENDING_AMENDMENT_INCOMPLETE_DATA`**（法令名つき「一部の未施行改正で施行予定日が取得できませんでした」）を付与。v1 の `getRevisionWarnings` が未知状態でも fail-safe 警告を出す思想を揃え、監査対象が pending_amendments からも警告からも静かに消える事故を防ぐ（Contract/Primary 視点）。

## 6. 実装ユニット

### 6.1 pure helper（`src/lib/evidence-metadata.ts`）

v1 の `cleanValue`（null/空→undefined）を再利用。純粋厳守（引数 mutate 禁止——`filter`/`map` の**戻り値**（新規配列）に `sort` を掛け、元 `revisions` を破壊しない）。

- `buildVersionPinnedUrl(lawRevisionId: string | undefined): string | undefined`（**共通ヘルパ抽出**）
  - `law_revision_id` から `https://laws.e-gov.go.jp/api/2/law_data/{id}` を導出。**v1 の `buildRevisionMetadata` もこれを使うようリファクタ**（現状インラインで重複・Arch 視点 Minor）。
- `buildPendingAmendments(revisions: EgovRevisionInfo[] | undefined): { amendments: PendingAmendment[]; excludedCount: number }`
  - `revisions` が無ければ `{ amendments: [], excludedCount: 0 }`。
  - `current_revision_status === 'UnEnforced'` を抽出。**全フィールドに `cleanValue`** を適用。
  - `enforcement_date`（= `cleanValue(amendment_enforcement_date)`）が取れない版は**除外し `excludedCount` を加算**（§5.5(b) の fail-safe 警告の根拠）。
  - `version_pinned_url` は `buildVersionPinnedUrl(law_revision_id)`。`repeal_status` は passthrough（`cleanValue`）。
  - ソート: **第1キー `enforcement_date` 昇順、第2キー `law_revision_id` 昇順**（同日 tie を決定的化）。
- `getPendingAmendmentWarnings(built: { amendments: PendingAmendment[]; excludedCount: number }, lawTitle: string): WarningMessage[]`
  - `amendments` が1件以上なら `UNENFORCED_AMENDMENT_PENDING`（§5.3）。最も近い施行予定日は `Math.min` 相当（`amendments` の `enforcement_date` 最小・ソート非依存で防御的）。`repeal_status != 'None'` の件を「廃止予定 M 件」として改正 N 件と分けて数える。
  - `excludedCount > 0` なら `PENDING_AMENDMENT_INCOMPLETE_DATA`（§5.5(b)）を追加。
  - どちらも無ければ `[]`。

### 6.2 `egov-client.ts` / `egov-source-adapter.ts` / `cache.ts`
§4 のとおり `fetchLawRevisions(lawId)` と `lawRevisionsRawCache` を追加。

### 6.3 `law-service.ts`
```ts
export async function getPendingAmendments(
  lawId: string,
): Promise<{ amendments: PendingAmendment[]; excludedCount: number }> {
  const { revisions } = await fetchLawRevisions(lawId);
  return buildPendingAmendments(revisions);
}
```
（`PendingAmendment` 型は `types.ts` に定義し law-service/helper/tool で共有）

### 6.4 `get-article.ts`
- input schema に `include_pending_amendments` を追加。tool 本体 description にも nudge（§5.1）。
- outputSchema に `pending_amendments: z.array(pendingAmendmentSchema).optional()` を追加。
- handler：条文取得（既存 v1 経路）が成功した**後**、`args.include_pending_amendments === true` のときだけ pending を取得。**pending の取得・変換は条文取得とは別の inner try/catch** に包み、pending 失敗が外側 catch（`mapErrorToEnvelope`＝`data:null` 全損）に落ちないことを保証する（Arch 視点 Major——条文成功を絶対に失わない）:
  ```ts
  let pendingAmendments; let degraded = false;
  const revisionWarnings = [...freshnessWarnings, ...v1RevisionWarnings];  // v1 の警告
  const partialFailures = [];
  if (args.include_pending_amendments === true) {
    try {
      const built = await getPendingAmendments(result.lawId);
      pendingAmendments = built.amendments;                       // [] も含め常に代入（= 確認済み）
      revisionWarnings.push(...getPendingAmendmentWarnings(built, result.lawTitle));
    } catch (error) {
      degraded = true;
      partialFailures.push({ source: 'egov', target: `law_revisions:${result.lawId}`, reason: 'upstream_unavailable' });
      observabilityRegistry.recordPartialFailure('egov', 1);
      revisionWarnings.push({ code: 'PENDING_AMENDMENT_CHECK_FAILED', message: `${result.lawTitle}: 未施行改正の確認に失敗しました…` });
      // pendingAmendments は undefined のまま
    }
  }
  // envelope: status = partialFailures.length > 0 ? 'partial' : 'ok'; degraded; partial_failures; warnings; data.pending_amendments = pendingAmendments
  ```
- 既存の freshness/revision 警告（v1）とは独立に merge。`pending_amendments` は param=true かつ成功時のみ present（未施行なしなら `[]`、degrade 時は undefined）。

## 7. テスト戦略（TDD）

- **pure helper 単体**（evidence-metadata）:
  - `buildVersionPinnedUrl`（id あり→URL・undefined→undefined）。
  - `buildPendingAmendments`（複数 UnEnforced の (enforcement_date, law_revision_id) 昇順・**同日 tie が law_revision_id で決定的**・CurrentEnforced/PreviousEnforced/Repeal(status) 除外・空→`{amendments:[],excludedCount:0}`・**enforcement_date 欠落版を除外し excludedCount 加算**・**null フィールド（`amendment_law_title:null` 等）で validation error を出さない**・**入力 `revisions` 配列を mutate しない**・`repeal_status` passthrough）。
  - `getPendingAmendmentWarnings`（空→無警告・件数＋最近施行日（未ソート入力でも min で正しい）・法令名接頭・**廃止予定を改正と分けて数える**・**excludedCount>0 で `PENDING_AMENDMENT_INCOMPLETE_DATA`**）。
- **adapter**: `fetchLawRevisions` を fetch stub で（`law_revisions` fixture・cache ヒットで2回目 fetch なし）。
- **law-service**: fixture（安衛法型の複数 UnEnforced＋CurrentEnforced＋PreviousEnforced）から `getPendingAmendments` が `{amendments, excludedCount}` を昇順で返す。
- **get_article 統合**（`callTool` 経由・実 outputSchema 検証）:
  - `include_pending_amendments` 省略/false → `/law_revisions` を引かない（fetch 呼ばれない）・`pending_amendments` undefined・`status:'ok'`。
  - true → `pending_amendments` 複数件（昇順）＋`UNENFORCED_AMENDMENT_PENDING`（hedge 含む）警告。**text に「## 未施行の改正」節が出ないこと**も assert（§5.4 の削除を固定）。
  - **degrade**: `/law_revisions` が失敗（fetch reject/404）しても**条文は返り**（`data` 非 null）、`status:'partial'`＋`degraded=true`＋`partial_failures`（reason 分類）＋`PENDING_AMENDMENT_CHECK_FAILED` 警告、`pending_amendments` は undefined。
  - 未施行なし（全 CurrentEnforced の fixture）で true → `pending_amendments: []`・警告なし・`status:'ok'`。
- **fixture**: `tests/fixtures/egov/law-revisions-*.json`（複数 UnEnforced＋同日 tie＋null フィールド＋enforcement_date 欠落を含む安衛法型／未施行なしの単純型）。

## 8. リリース
wire contract の additive 追加（input optional bool・output optional array・新警告 code）＝ **minor bump 相当**。version は次 minor 相乗り（v1 と同様）。CHANGELOG `[Unreleased]` に追記。

## 9. レビュー台帳（5視点サブエージェント）

**設計原則の再確認**: v1 §10 の原則（契約はデータ実性質で規定・関数は入力領域に対し全域）に加え、v2 で「**表示テキストは構造化の二次生成物**（SPEC.md §9.5）——監査メタを新規 text 節で三重化しない」を確認。

| 出所 | 深刻度 | 指摘 | 処理 |
|---|---|---|---|
| Domain | Critical | 誤帰属 hedge の欠落（v1 §7 で潰した問題の再発）。未施行改正は法令全体で単一条文が対象とは限らない | warning に anchor「現行施行版に対し」＋hedge を追加（§5.3）・改正法名は warning に列挙しない |
| Scope | Major | text 節は SPEC.md §9.5＋v1 前例に反する三重表現 | **§5.4 text 節を削除**（warning＋構造化の2層に集約）。Domain の text 固有懸念も同時解消 |
| Contract / Arch | Major×2 | degrade 時 `status:'ok'` は「partial_failures 非空＝partial」不変条件を破り observability の partials を素通り | `status = partial_failures>0 ? 'partial':'ok'`＋`recordPartialFailure('egov')`（§5.5a） |
| Domain / Primary | Major | 段階施行で廃止予定/初制定(mission:'New')が「改正」と混在し得る | `repeal_status` passthrough＋改正/廃止を分けて数える（§5.2/§5.3/§6.1） |
| Primary | Major | `amendment_enforcement_date` は required 保証なし（OpenAPI 記載なし・同一版が /law_data で null 実例） | §3 確度を下方修正・欠落版除外＋fail-safe `PENDING_AMENDMENT_INCOMPLETE_DATA`（§5.5b）・全 field cleanValue |
| Arch | Critical→**非問題** | 共有 circuit breaker が law_revisions 失敗で law_data を巻き添え | **一次証拠で裁定**：`recordSuccess()` が成功毎に reset・get_article は law_data を先に引くため蓄積せず（§3・http-source-adapter.ts:121）。adapter 改修不要 |
| Arch | Major | degrade を tool 層直書きは条文成功を巻き添える risk | pending 取得を独立 inner try/catch に・条文成功を絶対に失わない（§6.4） |
| Arch | Major | egov 層が生 Error を投げ reason='Error'・retryable 誤判定 | 最小策 reason='upstream_unavailable' 固定。companion fix として egov-source-adapter で型付きエラー化を推奨（v1 も改善） |
| Primary | Minor | 同日複数 UnEnforced（安衛規則4件同日）で sort 未文書 | 第2キー `law_revision_id`（§6.1） |
| Primary | Minor | 未施行版は最大15件（健保法・3年超） | 全件維持（text 節削除で冗長性懸念解消）。schema `.max()` は付けない（超過で validation error＝tool 全損）。§10 |
| Arch | Minor | `version_pinned_url` 生成が v1 と重複 | `buildVersionPinnedUrl` 共通ヘルパ抽出（v1 もリファクタ・§6.1） |
| Domain / Scope | Minor | opt-in 既定 false で「未確認」を「改正なし」と誤読 | tool description に「未確認≠改正なし」nudge（§5.1） |
| Scope | Minor→**反証** | UnEnforced 版 URL は 403/404 かも | **一次証拠で 200 実測**（§3）。`version_pinned_url` 維持 |
| Arch | Minor | 純粋性・警告が pending[0] のソート順に依存 | filter/map の戻り値を sort（入力不変）・最近日は min で防御的（§6.1） |
| Primary | 情報→**v1 follow-up** | 登録40法令中 4法令（社労士法含む）は CurrentEnforced 版を持たず現行版が PreviousEnforced タグ。v1 の `LAW_NOT_CURRENTLY_ENFORCED`（/law_data 単一 revision_info を読む）は実害薄いが要確認 | v2 の UnEnforced 抽出には無影響。**v1 の follow-up チケット**として別途 |

## 10. Open questions / 決定事項
- ~~degrade 時の `status`~~ → **解決**: `'partial'`（get_evidence_bundle 規約と統一・§5.5a）。
- ~~件数上限~~ → **解決**: unbounded 維持（最大15件と小・schema `.max()` は footgun ゆえ付けない。pathological 時のみ実装側 slice＋注記）。
- ~~`version_pinned_url` の v1 共通化~~ → **解決**: `buildVersionPinnedUrl` 抽出（§6.1）。
- **残**: `include_pending_amendments` を将来 `get_evidence_bundle` にも広げる際の一貫性（本 spec は get_article 限定・意図的 follow-up）。
- **残（v1 follow-up・別チケット）**: CurrentEnforced 版を持たない法令（社労士法等）での v1 `LAW_NOT_CURRENTLY_ENFORCED` 挙動の確認。egov 層の型付きエラー化（degrade reason 精度＋v1 retryable 判定の改善）。
