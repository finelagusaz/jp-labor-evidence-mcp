# egov 鮮度の「裏付けつき」最新化 — 設計仕様書

- 日付: 2026-07-13
- ステータス: Reviewed（4視点レビュー反映済み・実装待ち）
- 作業ブランチ: `chore/egov-freshness-refresh`
- 関連: CLAUDE.md「Gotchas / egov GENERATED_AT」、[2026-04-25-freshness-warnings-design.md](2026-04-25-freshness-warnings-design.md)
- レビュー: 設計原則整合 / 実装ファクトチェック / ドキュメント規約整合 / codex 独立総合 の4視点を反映（末尾「レビュー反映ログ」参照）

## 背景

egov（法令）索引は bundled データで、真のソースは [src/lib/law-registry.ts](../../../src/lib/law-registry.ts) の `LAW_ID_MAP`（**41法令（照合の結果、労働基準法施行令の削除・船員保険法の修正で 40 に収束）**）。`initializeEgovIndex()` がここから構築する。鮮度は `freshness: 'unknown'` 固定 + `bundled_age_days`（`GENERATED_AT` からの経過日数）で露出する。

- 現状 `GENERATED_AT` = `2026-06-10T00:00:00.000Z`（[egov-index.ts:10](../../../src/lib/indexes/egov-index.ts#L10)。**実リテラルは 10 行目**、`:9` は空行）
- 本日 2026-07-13 時点で経過 **33日**。閾値 `BUNDLED_AGE_THRESHOLD_DAYS = 60`（[freshness-warnings.ts:8](../../../src/lib/indexes/freshness-warnings.ts#L8)）に未達 → `BUNDLED_INDEX_AGED` 警告は**未発火**
- **発火条件は 60日閾値だけではない**: 実コード [freshness-warnings.ts:62-63](../../../src/lib/indexes/freshness-warnings.ts#L62) は `aged`（60日超）**または** `crossedBoundary`（生成時刻が直近 4/1・10/1 施行境界より前）の二条件。現状は 6/10 生成が直近境界 4/1 を跨いでいないため未発火（60日側の発火は約 8/9 以降）。**bump 後（生成 7/13）は次境界 10/1 を跨いだ時点で `crossedBoundary` が発火する**——これは「7/13 検証済み bundle が 10/1 施行改正を反映しない」という*望ましい*挙動であり、境界系テストは bump 後もこの挙動を前提に評価する
- `GENERATED_AT` は利用者に「生成日: YYYY-MM-DD JST」として提示される（[freshness-warnings.test.ts:365](../../../tests/freshness-warnings.test.ts#L365)）

### 誠実性の要請

`GENERATED_AT` を今日へ動かせば `bundled_age_days` は 0 に戻り「生成日: 今日」と表示される。しかし収録内容（41法令）を再検証せずに日付だけ動かすと、鮮度指標が実態を偽ることになる。社労士・legal を利用者とし、一次資料の正確性を旨とする本プロダクトでは看過できない。よって**内容照合による裏付けの上で** bump する。

## 目的

law-registry の41法令が本日時点で e-Gov と一致することを機械照合で裏付け、その証跡の上で `GENERATED_AT` を 2026-07-13 へ更新する。

### `GENERATED_AT` が保証する意味と、その限界（重要）

bump は egov 全エントリの `updatedAt` と meta（`generated_at` / `last_success_at`）を一律に当日へ書き換えるため、利用者へ「bundle 全体が当日再生成された」印象を与えうる。この表示が誠実であるための前提と限界を明記する。

- **保証するもの（＝「生成日: 今日」が事実である根拠）**: bundled egov 索引は**条文本文を保持せず、索引メタのみ**（`law_title` / `law_num` / `aliases` / `source_url` / `canonical_id`。body 無し）。したがって「41法令の現存性 + 正式名称」の照合は、bundled 索引が実際に保持する内容の実質を**完全に再確立**する。この範囲では「生成日 = 検証日」は誠実である。
- **保証しないもの（＝過大表示を避けるための限界）**: 本照合は**メタデータの現在性**（law_id が生存し、正式名称が一致すること）を保証するのみで、**条文改正・附則・施行日の反映は保証しない**。これらは非目標であり、`GENERATED_AT` は「条文が最新である日付」ではなく「41法令の lawId と正式名称を e-Gov で確認した日付」を意味する。PR 説明・スクリプト冒頭コメントにもこの限界を明記し、LLM/利用者が条文レベルの最新性を誤読しないようにする。

## 非目標（スコープ外・YAGNI）

- 未収録法令の網羅拡大（別 spec）。本作業は**既存41件の現在性検証に限定**し、収録範囲そのものの妥当性（追加すべき法令、廃止後の代替法令への移行、alias の検索適合性）は検証対象外
- 条文本文・条番号レベルの深い突合（現存性と正式名称のみ）
- 改正沿革（`revision_info` / `amendment_enforcement_date` / 未施行改正）の追従。**bundled index は解決マップで本文は live 取得ゆえ、改正検知を index freshness に結びつけるのは category error**。改正メタは Evidence.version_info の材料として [2026-07-13-egov-revision-version-info-backlog.md](2026-07-13-egov-revision-version-info-backlog.md) へ切り出し済み
- `law_num`（法令番号）の照合。law_id に対して安定であり、実務上のドリフト（law_id 変更 = NOT_FOUND、名称変更 = NAME_MISMATCH）は索引キー `(title, id)` の照合で捕捉されるため対象外とする
- mhlw・jaish の bundled seed 化（runtime learning 型のまま。別次元の設計）

### ロードマップ上の位置づけ

本作業は SPEC.md の Phase に属する機能開発ではなく、**bundled データの衛生を保つ保守 chore** である。以下と直交する:

- **SPEC §14.2.7 ワークストリーム L**（[SPEC.md:1233](../../../SPEC.md#L1233) e-Gov 法令メタによる差分検知）および既存実装 [detectEgovChanges()](../../../src/lib/indexes/change-detectors.ts#L36) とは別物。`detectEgovChanges()` は**ネットワーク非依存**で「runtime snapshot が bundled メタより古いか」を timestamp 比較するだけ（`BUNDLED_INDEX_NEWER`）。本 verify スクリプトは**ネットワーク依存**で「登録名が live e-Gov と一致するか」を検証する。両者は補完関係で、bump → 人が registry 修正 → `detectEgovChanges` が差分を報告 → sync が再シリアライズ、というハンドオフが成立する
- **Phase 4.x のワークストリーム N/O**（sync runner の source 別 policy、MHLW/JAISH metadata 差分）とも別。非目標の mhlw/jaish 除外により区別される

## 設計

### コンポーネント

#### 1. 照合スクリプト `scripts/verify-egov-registry.ts`（恒久化）

- 既存 e-Gov v2 クライアント [egov-source-adapter.ts](../../../src/lib/source-adapters/egov-source-adapter.ts) の `egovSourceAdapter.fetchLawDataById(lawId)` を流用（`GET /api/2/law_data/{lawId}`）。実在確認済み（[egov-source-adapter.ts:23](../../../src/lib/source-adapters/egov-source-adapter.ts#L23)）
- `LAW_ID_MAP` の全41エントリを順次照合。レート制御は既存クライアント内蔵（`minIntervalMs: 200` / `maxConcurrency: 1` / circuit breaker `threshold: 3` / `resetMs: 30_000`）に委譲
- 各法令を4分類:
  - **OK**: 取得成功かつ `extractLawTitle(data)`（[egov-parser.ts:82](../../../src/lib/egov-parser.ts#L82)、`law_full_text` ツリーの `LawTitle` を走査）が登録名と一致
  - **NAME_MISMATCH**: 取得成功だが正式名称がズレ（名称変更の疑い）
  - **NOT_FOUND**: 404 等で取得不可（廃止 / lawId 変更の疑い）
  - **ERROR**: 一時エラー・タイムアウト・circuit-open（要再確認）

##### 照合の実装契約（実装前に固定する）

現行アダプタの実態を踏まえ、以下を実装前に確定する。曖昧なまま書くと誤分類・偽の裏付けを生む。

- **名称「一致」の比較規約**: `extractLawTitle` は文字列を連結するのみで空白・異体字を正規化しない。**表層の空白は正規化してから比較**し、正規化後に残る差を `NAME_MISMATCH` とする（無害な表記差での誤検知と、真の改名の見逃しの両方を避ける）。正規化規則はスクリプト内に明示する
- **NOT_FOUND / ERROR の型付け**: [http-source-adapter.ts](../../../src/lib/source-adapters/http-source-adapter.ts) は非 2xx を `Error("HTTP {status} ...")` として投げるだけで型付き status を返さない。当面は**この chore の範囲内でエラー内容から 404 を判別**する（アダプタを typed error 化する改修はより清潔だが本 chore のスコープ外とし、必要なら別 Issue）。判別方針をスクリプトに明記する
- **circuit breaker の扱い**: 3連続失敗で 30秒 circuit が開き、以降の未照合分は実リクエストなしで一括失敗しうる。**circuit-open 由来の失敗は `ERROR`（未確認）として扱い、決して「照合済み」に数えない**。リトライ/バックオフ、中断か継続かの方針、および後述の exit code を定義する
- **キャッシュ回避**: `fetchLawDataById` は `lawDataRawCache`（TTL 1時間、[egov-source-adapter.ts:23-27](../../../src/lib/source-adapters/egov-source-adapter.ts#L23)）を先に返す。**verify モードでは新規プロセス実行を前提とするか、キャッシュを明示的に無効化/クリアする**。同一プロセス再実行が「当日の live 再照合」にならない罠を避ける
- **レポート出力先**: JSON レポートは**既定で gitignored パスへ出力するか、または一切ファイルを書かず stdout のみ**とする。ファイル出力する場合は `--out` で指定可能にし、上書き可否を定め、必要なら `.gitignore` にパターンを追加する（現行 `.gitignore` には該当パターンが無い）
- **型検査**: `npm run build` の `tsconfig.json` `include: ["src/**/*"]` は `scripts/` を型検査しない。**スクリプトの型安全は別経路**（`tsx` 実行時の型エラー、または typecheck 用 npm script / include 調整）で担保する。「build 成功」だけを success criteria にしない

- 出力: 標準出力の要約 + JSON レポート（上記の出力先方針に従う）
- package.json に npm script（例: `verify:egov`）を追加
- **ネットワーク依存ゆえ CI 非対象**である旨をスクリプト冒頭コメントと CLAUDE.md に明記（既存 `sync:indexes` の「ネットワークなし」原則と区別）。加えて `release:check` / `prepublishOnly` の publish gate にも**混入させない**（現状これらは test+build+pack のみで自然に除外されるが、将来の取り込み事故を防ぐため明記する）

#### 2. law-registry への手動反映

- 差分（NAME_MISMATCH / NOT_FOUND）はレポートを人が確認し、`LAW_ID_MAP` / `LAW_ALIAS_MAP` を手で修正
- 修正後は再照合し、**同一実行のレポートで全件（40件）が `OK` に収束**させる（後述の bump ゲート参照）
- **文書追従（条件付き）**: registry を編集して**法令数や名称が変わった場合**は、以下も同一 PR で追従する。全件 OK で差分ゼロなら不要:
  - [README.md](../../../README.md) の「41 法令」表記（`:189` / `:199`）
  - [docs/supported-laws.md](../../../docs/supported-laws.md) の一覧（件数 `:3` および該当テーブル行）

#### 3. `GENERATED_AT` bump と追従

##### bump の不可逆ゲート（H2）

`GENERATED_AT` の書き換えは以下を**すべて満たす場合のみ**行う。「日付だけ動かすと鮮度指標が実態を偽る」という誠実性原則を、ゲートとして機械的に強制する。

- **同一実行**の照合レポートで、全件（40件）が `OK`。`NOT_FOUND` / `NAME_MISMATCH` / `ERROR` が **0件**（古い実行のレポートの流用を禁止）
- レポートの**検証実施日が bump 日（2026-07-13）と一致**（乖離があれば再実行）
- スクリプトは**成功時のみ exit 0**、未確認が1件でも残れば非0で終了
- 生成した**レポートを PR に証跡として添付**し、bump の裏付けを再現可能にする
- （success criteria の「反映済み」= 上記「同一実行で全件 OK」を指す。人手修正しただけの状態は未達）

##### bump 対象

- [egov-index.ts:10](../../../src/lib/indexes/egov-index.ts#L10) の literal を `2026-07-13T00:00:00.000Z` へ

##### テスト追従（正確版）

`2026-06-10` をハードコードし GENERATED_AT に**意味的連動する**テストのみ追従する。全リポジトリ grep で巻き込まれ先を洗った結果は以下で確定（未記載の追従先は無い）。

**追従が必要（4件）:**

1. [tests/freshness-warnings.test.ts](../../../tests/freshness-warnings.test.ts) — `GENERATED_AT_ISO`/`_MS`（`:8-9`）と「**生成日: 2026-06-10 JST**」（`:365`）のみを `2026-07-13` へ。
   - ⚠️ **罠**: 同ファイルの「**最終同期: 2026-06-10 JST**」（`:357`）と隣接する `.not.toContain('2026-06-09')`（`:358`）は **egov に連動しない**。これはローカルの mhlw フィクスチャ（`generatedIso = '2026-06-09T15:30:00.000Z'` = 06-10 00:30 JST、`:346`）由来。**触ってはならない**。書き換えると隣接アサートごと壊れる
2. [tests/tool-freshness-warnings.test.ts](../../../tests/tool-freshness-warnings.test.ts) — `GENERATED_AT_MS`（`:6`）。+61日/+3日オフセットで `BUNDLED_INDEX_AGED` の発火/非発火を制御
3. [tests/egov-index.test.ts](../../../tests/egov-index.test.ts) — `setSystemTime('2026-06-10T12:00:00.000Z')`（`:7`）。bump 時に追従しないと age が負値化して赤化
4. [tests/status-resource.test.ts](../../../tests/status-resource.test.ts) — `GENERATED_AT_ISO`（`:4`）+ `expect(status.indexes.egov.generated_at).toBe(...)`（`:24`）+ `bundled_age_days.toBe(0)`（`:25`）。本番 egov meta に直依存

**追従不要（確定。誤って触らない）:**

- [tests/indexes-time.test.ts](../../../tests/indexes-time.test.ts) — `computeBundledAgeDays` の**純関数単体テスト**。生成時刻を明示引数で渡し、egov-index の `GENERATED_AT` を import も参照もしない（`:10`, `:13-21`）。bump しても赤化しない（コード上デカップリング済み。旧「要精査」は解消）
- [tests/find-related-sources-tool.test.ts:22](../../../tests/find-related-sources-tool.test.ts#L22)、[tests/tool-wire-contract.test.ts:31](../../../tests/tool-wire-contract.test.ts#L31) — `getEgovIndexMeta().generated_at` から時刻を導出（#14 で time-bomb 解消済み）
- `tests/observability.test.ts` — 別ローカル定数 `EGOV_GENERATED_AT = '2026-04-02...'` を使い fake meta を投入。本番 GENERATED_AT からデカップル済み

#### 4. CLAUDE.md の追従 test 記載の是正

現行 CLAUDE.md（[CLAUDE.md:47](../../../CLAUDE.md#L47)）は追従 test を3件（freshness-warnings / tool-freshness-warnings / egov-index）と記す。

- **`status-resource.test.ts` を4件目として追加**する（漏れていた）
- **`indexes-time.test.ts` は追加しない**（追従不要と確定。上記参照）
- 併せて CLAUDE.md「## Commands」に `verify:egov`（ネットワーク依存・CI/publish gate 対象外・maintainer 用）を追記する

#### 5. リリース / CHANGELOG / version（H3。方針: 据え置き・次の minor に相乗り）

本 chore は**独立 version を切らず**、`[Unreleased]` に追記して次の意図的な minor リリースへ相乗りさせる。理由: `[Unreleased]` には既に deps メジャー更新 + 最低 Node `>=24`（実質 breaking → minor 以上推奨）が滞留しており、egov 保守が単独でリリースを強制する必要はなく、単独 patch を切ると breaking 変更まで patch ラベルで出荷されてしまうため。

- **version は据え置き**: `package.json`（現 0.5.0）、`src/server.ts` の `SERVER_VERSION`、`package-lock.json` は**変更しない**
- [CHANGELOG.md](../../../CHANGELOG.md) の `## [Unreleased]` に追記:
  - `### Changed`: 「bundled law index の `GENERATED_AT` を `2026-07-13` に更新（内容照合の裏付けの上で再スタンプ）+ freshness 系テストの時刻基準を追従」
  - `### Added`: 「`scripts/verify-egov-registry.ts` + `verify:egov`（maintainer 用・ネットワーク依存・CI 対象外）」
- **merge しても publish されない**: `release.yml` は `package.json` version 変更で発火するため、version 据え置きなら発火しない
- egov refresh は次の minor リリース（deps と同梱、0.6.0 見込み）で出荷される。`## [x.y.z] - 実日付` への昇格と version 3ファイル同期は、その**リリースを切る PR の責務**（本 chore のスコープ外）

### データフロー

```text
LAW_ID_MAP (41件) + 登録名
   │
   ▼ verify-egov-registry.ts（新規プロセス / キャッシュ回避）
fetchLawDataById(lawId) ──→ e-Gov API v2
   │
   ▼ 4分類 (OK / NAME_MISMATCH / NOT_FOUND / ERROR) ＋正規化比較
差分レポート(stdout + gitignored JSON、検証日付き)
   │
   ├─ 差分あり → law-registry.ts を人が修正 → 文書追従 → 再照合
   └─ 同一実行で全41件 OK / 未確認0件
        → GENERATED_AT を 2026-07-13 へ bump + test 追従(4件)
        → CLAUDE.md 是正 + CHANGELOG [Unreleased] 追記
```

### エラーハンドリング（誠実性の要）

- 取得できなかった法令（ERROR / circuit-open）は握りつぶさず「要再確認」として明示。**1件でも未確認が残る間は「全件裏付け済み」と称さず、bump もしない**（スクリプトは非0 exit）
- NOT_FOUND は廃止 / lawId 変更の兆候としてユーザー判断を仰ぐ
- API 一時障害は既存クライアントの circuit breaker / `minIntervalMs` に委譲。ただし circuit-open による一括失敗を「照合済み」と誤認しないこと

## 検証（success criteria）

- 照合レポートが「**同一実行で全件（40件）すべて OK**、`NOT_FOUND`/`NAME_MISMATCH`/`ERROR` が 0件」を示し、検証日が bump 日と一致
- レポートが PR に添付されている
- `npm test` 緑（追従漏れ・誤追従があれば freshness/`BUNDLED_INDEX_AGED`/`status-resource` 系が赤化して検知できる）
- `npm run build` 成功、**かつ** `scripts/verify-egov-registry.ts` の型検査が別経路で通ること
- CHANGELOG `[Unreleased]` に `### Changed` / `### Added` が追記され、version は据え置き
- `npm run sync:indexes` 後の egov meta が新 `generated_at`（2026-07-13）を反映

## リスクと未解決事項

- **e-Gov API v2 の可用性・スキーマ**: `law_data/{lawId}` のレスポンス（`law_full_text` ツリー）から `extractLawTitle` で正式名称を確実に取り出せるかを、実装初期に1件で検証
- **エラー分類のアダプタ依存**: 404 判定を文字列解析に頼る当面方針の脆さ。typed error 化は別 Issue 候補
- **PR 運用**: 本ブランチは現 deps-update 起点。deps-update が main にマージされ次第、egov PR の base を main にすれば diff は egov 分に収束

## 参考（既存資産）

- [egov-client.ts](../../../src/lib/egov-client.ts) — `fetchLawData` / `searchLaws` / `getEgovUrl`
- [egov-source-adapter.ts](../../../src/lib/source-adapters/egov-source-adapter.ts) — `EGOV_API_BASE`, `fetchLawDataById`（`:23`）, レート制御（`:14-19`）
- [egov-parser.ts:82](../../../src/lib/egov-parser.ts#L82) — `extractLawTitle`
- [http-source-adapter.ts](../../../src/lib/source-adapters/http-source-adapter.ts) — 非2xx の Error 送出 / circuit breaker
- [change-detectors.ts:36](../../../src/lib/indexes/change-detectors.ts#L36) — `detectEgovChanges()`（ネットワーク非依存。本作業と直交・補完）
- CLAUDE.md「Gotchas / egov GENERATED_AT」— bump 時の test 追従必須の記述

## レビュー反映ログ

2026-07-13、4視点（設計原則整合 / 実装ファクトチェック / ドキュメント規約整合 / codex 独立総合）+ サブエージェント・レビューの指摘を反映。SPEC 設計原則との硬直的矛盾は無し。主な反映:

| 由来 | 指摘 | 反映 |
| --- | --- | --- |
| codex / 原則整合 | `GENERATED_AT` の意味が過大表示になりうる | 「保証するもの/しないもの」を目的に明記（本文非保持ゆえ存在確認＝生成同等、ただしメタ現在性のみ保証） |
| codex | bump ゲートが曖昧（「反映済み」未定義、古いレポート流用可） | §3 に不可逆ゲート（同一実行・全件OK・検証日一致・exit 0・PR 証跡）を新設 |
| ドキュメント整合 | CHANGELOG / version / release が spec に欠落 | §5 リリース方針を新設（据え置き・[Unreleased] 相乗り、ユーザー判断反映） |
| ファクトチェック | 追従テストリストの罠と誤り | 「最終同期」行は触るな（mhlw 由来）を明記、`indexes-time` を追従不要に確定、`status-resource` を追加 |
| codex | 404 分類・circuit-open・1h キャッシュ・tsconfig 型検査外 | §1「照合の実装契約」を新設 |
| codex | 名称一致の比較規約未定義 | §1 に正規化規約を追加 |
| ドキュメント整合 | README「41」/ docs 追従がスコープ外 | §2 に条件付き文書追従を追加 |
| 原則整合 | ロードマップ位置づけ欠落（L / N/O との関係） | 非目標に「ロードマップ上の位置づけ」を追加 |
| 原則整合 / codex | カレンダー境界トリガの取りこぼし | 背景に境界発火（bump 後 10/1）を追記 |
| 原則整合 | law_num 非照合の根拠・release gate 除外 | 非目標に law_num、§1 に release:check/prepublishOnly 除外を明記 |
| ファクトチェック / 原則整合 | 行番号 `:9`→`:10` | 全参照を修正 |
