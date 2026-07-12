# egov 鮮度の「裏付けつき」最新化 — 設計仕様書

- 日付: 2026-07-13
- ステータス: Draft（ユーザーレビュー待ち）
- 作業ブランチ: `chore/egov-freshness-refresh`
- 関連: CLAUDE.md「Gotchas / egov GENERATED_AT」、[2026-04-25-freshness-warnings-design.md](2026-04-25-freshness-warnings-design.md)

## 背景

egov（法令）索引は bundled データで、真のソースは [src/lib/law-registry.ts](../../../src/lib/law-registry.ts) の `LAW_ID_MAP`（約41法令）。`initializeEgovIndex()` がここから構築する。鮮度は `freshness: 'unknown'` 固定 + `bundled_age_days`（`GENERATED_AT` からの経過日数）で露出する。

- 現状 `GENERATED_AT` = `2026-06-10T00:00:00.000Z`（[egov-index.ts:9](../../../src/lib/indexes/egov-index.ts#L9)）
- 本日 2026-07-13 時点で経過 **33日**。閾値 `BUNDLED_AGE_THRESHOLD_DAYS = 60`（[freshness-warnings.ts:8](../../../src/lib/indexes/freshness-warnings.ts#L8)）に未達 → `BUNDLED_INDEX_AGED` 警告は**未発火**（発火は約 8/9 以降）
- `GENERATED_AT` は利用者に「生成日: YYYY-MM-DD JST」として提示される（[freshness-warnings.test.ts:365](../../../tests/freshness-warnings.test.ts#L365)）

### 誠実性の要請

`GENERATED_AT` を今日へ動かせば `bundled_age_days` は 0 に戻り「生成日: 今日」と表示される。しかし収録内容（41法令）を再検証せずに日付だけ動かすと、鮮度指標が実態を偽ることになる。社労士・legal を利用者とし、一次資料の正確性を旨とする本プロダクトでは看過できない。よって**内容照合による裏付けの上で** bump する。

## 目的

law-registry の41法令が本日時点で e-Gov と一致することを機械照合で裏付け、その証跡の上で `GENERATED_AT` を 2026-07-13 へ更新する。「生成日: 今日」という表示が事実に基づく状態を作る。

## 非目標（スコープ外・YAGNI）

- 未収録法令の網羅拡大（別 spec）
- 条文本文・条番号レベルの深い突合（現存性と正式名称のみ）
- mhlw・jaish の bundled seed 化（runtime learning 型のまま。別次元の設計）

## 設計

### コンポーネント

#### 1. 照合スクリプト `scripts/verify-egov-registry.ts`（恒久化）

- 既存 e-Gov v2 クライアント [egov-source-adapter.ts](../../../src/lib/source-adapters/egov-source-adapter.ts) の `egovSourceAdapter.fetchLawDataById(lawId)` を流用（`GET /api/2/law_data/{lawId}`）
- `LAW_ID_MAP` の全エントリを順次照合。レート制御は既存クライアント内蔵（`minIntervalMs: 200` / `maxConcurrency: 1` / circuit breaker）に委譲
- 各法令を4分類:
  - **OK**: 取得成功かつ `extractLawTitle(data)` が登録名と一致
  - **NAME_MISMATCH**: 取得成功だが正式名称がズレ（名称変更の疑い）
  - **NOT_FOUND**: 404 等で取得不可（廃止 / lawId 変更の疑い）
  - **ERROR**: 一時エラー・タイムアウト（要再確認）
- 出力: 標準出力の要約 + JSON レポート（`scratchpad` もしくは gitignored パスへ。リポジトリを汚さない）
- package.json に npm script（例: `verify:egov`）を追加
- **ネットワーク依存ゆえ CI 非対象**である旨をスクリプト冒頭コメントと CLAUDE.md に明記（既存 `sync:indexes` の「ネットワークなし」原則と区別）

#### 2. law-registry への手動反映

- 差分（NAME_MISMATCH / NOT_FOUND）はレポートを人が確認し、`LAW_ID_MAP` / `LAW_ALIAS_MAP` を手で修正
- 修正後は再照合し、全件 OK（または反映済み）に収束させる

#### 3. `GENERATED_AT` bump と追従

- [egov-index.ts:9](../../../src/lib/indexes/egov-index.ts#L9) の literal を `2026-07-13T00:00:00.000Z` へ
- 追従が必要な test（`2026-06-10` をハードコードし GENERATED_AT に意味的連動するもの）:
  1. [tests/freshness-warnings.test.ts](../../../tests/freshness-warnings.test.ts) — `GENERATED_AT_ISO`/`_MS` + 文字列アサート（「生成日: 2026-06-10 JST」「最終同期: 2026-06-10 JST」）
  2. [tests/tool-freshness-warnings.test.ts](../../../tests/tool-freshness-warnings.test.ts) — `GENERATED_AT_MS`
  3. [tests/egov-index.test.ts](../../../tests/egov-index.test.ts) — `setSystemTime('2026-06-10T12:00:00.000Z')`
  4. [tests/status-resource.test.ts](../../../tests/status-resource.test.ts) — `GENERATED_AT_ISO` + `expect(status.indexes.egov.generated_at).toBe(...)`（egov 実 meta に依存）
  5. [tests/indexes-time.test.ts](../../../tests/indexes-time.test.ts) — `computeBundledAgeDays('2026-06-10...')` の base（**要精査**: 単体テストの自前 base であり GENERATED_AT に意味的連動しない可能性。実装時に赤化するか確認して要否判断）
- 追従**不要**（`getEgovIndexMeta().generated_at` から導出）: [tests/find-related-sources-tool.test.ts:22](../../../tests/find-related-sources-tool.test.ts#L22)、[tests/tool-wire-contract.test.ts:31](../../../tests/tool-wire-contract.test.ts#L31)

#### 4. CLAUDE.md の追従 test 記載の補完

現行の CLAUDE.md は追従 test を3箇所（freshness-warnings / tool-freshness-warnings / egov-index）と記すが、**`status-resource.test.ts`（および要精査の `indexes-time.test.ts`）が漏れ**ている。実装で確定した追従先に合わせて CLAUDE.md を是正する。

### データフロー

```
LAW_ID_MAP (41件) + 登録名
   │
   ▼ verify-egov-registry.ts
fetchLawDataById(lawId) ──→ e-Gov API v2
   │
   ▼ 4分類 (OK / NAME_MISMATCH / NOT_FOUND / ERROR)
差分レポート(stdout + JSON)
   │
   ├─ 差分あり → law-registry.ts を人が修正 → 再照合
   └─ 全件収束 → GENERATED_AT を 2026-07-13 へ bump + test 追従
```

### エラーハンドリング（誠実性の要）

- 取得できなかった法令（ERROR）は握りつぶさず「要再確認」として明示。**1件でも未確認が残る間は「全件裏付け済み」と称さない**
- NOT_FOUND は廃止 / lawId 変更の兆候としてユーザー判断を仰ぐ
- API 一時障害は既存クライアントの circuit breaker / `minIntervalMs` に委譲

## 検証（success criteria）

- 照合レポートが「41件すべて OK 一致 または反映済み」を示す
- `npm test` 緑（追従漏れがあれば `BUNDLED_INDEX_AGED` 系が赤化して検知できる）
- `npm run build` 成功
- `npm run sync:indexes` 後の egov meta が新 `generated_at`（2026-07-13）を反映

## リスクと未解決事項

- **e-Gov API v2 の可用性・スキーマ**: `law_data/{lawId}` のレスポンスから正式名称を確実に取り出せるか（`extractLawTitle` の挙動）を実装初期に1件で検証
- **`indexes-time.test.ts` の追従要否**: 実装時に赤化有無で確定
- **PR 運用**: 本ブランチは現 deps-update 起点。deps-update が main にマージされ次第、egov PR の base を main にすれば diff は egov 分に収束

## 参考（既存資産）

- [egov-client.ts](../../../src/lib/egov-client.ts) — `fetchLawData` / `searchLaws` / `getEgovUrl`
- [egov-source-adapter.ts](../../../src/lib/source-adapters/egov-source-adapter.ts) — `EGOV_API_BASE`, `fetchLawDataById`, `searchLaws`
- [egov-parser.ts](../../../src/lib/egov-parser.ts) — `extractLawTitle`
- CLAUDE.md「Gotchas / egov GENERATED_AT」— bump 時の test 追従必須の記述
