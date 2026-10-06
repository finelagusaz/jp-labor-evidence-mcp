# Changelog

このプロジェクトの主な変更を記録します。

## [Unreleased]

## [0.9.0] - 2026-10-06

### Added

- `get_evidence_bundle` で附則を主根拠にできる。`get_article` と同じ `supplementary` / `subitem` / 文字列の `item` を受け付け、`article` は `supplementary` があれば省ける
  - 改正附則では、`/law_revisions` から引いた**改正法の題名**を先頭の検索キーワードにして関連通達を探す（厚労省の通達検索は法令番号では当たらず、題名では施行通達が上位に来ることを live で確かめた）。題名の取得に失敗したら `partial_failures` に記録して続ける
  - 附則では、条番号由来のキーワード（`労働基準法 第1条`）・条番号ごとの実務キーワード・条見出しを検索と順位づけに使わない。本則の同じ番号の条を指してしまうため
  - `article_locator` に `supplementary`（附則の key）と `subitem` を追加し、`item` を文字列でも返す

### Changed

- `get_evidence_bundle` / `diff_revision` の `title`・`canonical_id`・`paragraph`（bundle は `article_locator.paragraph`）に、`paragraph` を省いた号から特定した項を含める。`get_article` と同じ識別子になる（`diff_revision` の入力は従来どおり数値の `item` のみで、附則・細分は受け付けない）
- `diff_revision`: `paragraph` を省いた号が改正前後で別の項に解決されたら、警告 `DIFF_PARAGRAPH_MISMATCH` を出す（号が改正で別の項へ移った場合に、異なる項どうしを黙って比べないため）
- 関連通達の検索キーワードを本文から作るとき、`施行期日`・`経過措置` と条名（`第百二十二条` など）を除く

## [0.8.2] - 2026-10-06

### Changed

- 条全体を返すとき、`body` の先頭に条見出しの行（`（労働時間）`）を付けないようにした。本文の見出し行 `#### （労働時間）` と重なっていたため。項・号・細分だけを返すときは本文に条見出しが含まれないので、これまでどおり先頭に付ける（`get_article` / `get_evidence_bundle` / `diff_revision`、deprecated の `get_law`）
  - 登録 40 法令の 12,416 条を調べ、条見出しは常に条の直下に 1 つだけで、入れ子の中にだけ条見出しがある条は無いことを確かめた（先頭行を省いても情報は欠けない）

### Fixed

- 中に括弧を含む条見出し（安衛則 附則（昭和52年労働省令第32号）第3条「（車両系建設機械（整地・運搬・積込み用及び掘削用）運転技能講習に関する経過措置）」）で、0.8.1 の修正が効かず括弧が二重のままだった。先頭の括弧が末尾の括弧と対になっているかで判定するようにした

## [0.8.1] - 2026-10-06

### Fixed

- 条文の `body` の先頭の条見出しが `（（労働時間））` と括弧が二重になっていた（`get_article` / `get_evidence_bundle` / `diff_revision`、deprecated の `get_law`）。e-Gov の条見出しは括弧つきで届くため、取り出す時点で外側の括弧を外すようにした
- 同じ原因で、関連通達の検索キーワードに括弧つきの条見出し（`（労働時間）`）が入っていた（`get_evidence_bundle` / `find_related_sources`）。また通達の順位づけで「条見出しを含むか」の判定が括弧つきの形で行われ、ほとんど成り立っていなかった。どちらも括弧なしの語（`労働時間`）を使う。`find_related_sources` の `article_caption` に括弧つきで渡された場合も同じく外す

## [0.8.0] - 2026-10-06

### Added

- **附則の取得**（経過措置・施行期日の確認）: `get_article` に `supplementary` を追加。`"制定"` で制定時附則、改正附則は改正法の法令番号で指定する。e-Gov の附則の属性（`令和八年六月二四日法律第四六号`、位取りの漢数字）と `/law_revisions` の `amendment_law_num`（`令和八年法律第四十六号`、十を使う漢数字）の両方の書き方を受け付け、正規形（`令和8年法律第46号`）にそろえる。`revision_metadata.amendment_law_num` などをそのまま渡せる
  - 条を持たない附則（労基則では 188 件中 135 件）は `article` を省き、`paragraph` / `item` / `subitem` で直接指定できる。何も指定しなければ附則全体を返す
  - 出力に `supplementary`（`key`・e-Gov の `amend_law_num`・抄かどうか）を追加。`canonical_id` は `egov:{law_id}:suppl:{key}[:article:…]`
  - 該当する附則が複数あるときは、推測で選ばず候補を示して `invalid` を返す
- 新しい tool `list_suppl_provisions`: 法令の附則を公布日の新しい順に一覧する。年や法令番号で絞り込め、`limit`（既定 30・最大 200）と `offset` でページングする。`get_article` に渡す `key` を返す
- **号の下の細分**: `get_article` に `subitem` を追加（`"イ"`、`"イ (1)"`、`"イ-(1)-(i)"`）。3 階層までたどる
- `get_article` の `item` を文字列でも受け付ける。枝番号の号（`"3の2"`）と漢数字（`"六"`、`"十二の五の二"`）を指定できる。`canonical_id` の号は正規形（`1の2`）にそろえる

### Changed

- `paragraph` を省いて `item` を指定したとき、これまでは `item` が黙って無視され条全体が返っていた。全項から号を探し、1 つに決まればその項を返す（`data.paragraph` に項番号を載せる）。複数の項にあれば項を示して `invalid` を返す。条文の取得経路を共有する tool（`get_article` / `get_evidence_bundle` / `diff_revision`、deprecated の `get_law`）すべてが同じ挙動になる。なお `get_evidence_bundle` / `diff_revision` の `canonical_id` は、特定した項をまだ含めない（後続で対応）

## [0.7.2] - 2026-10-05

### Fixed

- 一部の法令（2026-10-04 時点で労働組合法・厚生年金保険法）で、`get_article` / `get_evidence_bundle` が現行版に対して `LAW_NOT_CURRENTLY_ENFORCED`（「この版は過去の施行版であり、現行版ではありません。より新しい施行版が存在します」）を誤って出していた。e-Gov が施行済みの最新版に `PreviousEnforced` のタグを付けたままにしているためで、返している版そのものは正しい。`PreviousEnforced` のときだけ `/law_revisions` を取得して施行日で照合し、施行済みの中で最新と確認できた場合は警告を出さない
  - 照合は施行日だけで行う（live 調査で、施行日と未施行→施行の切り替えは正確、タグは不正確だった）。施行日が今日（JST）以前で、ほかの施行済み版がすべてそれより前の施行日のときだけ最新とみなす
  - 同じ施行日の別版がある・施行日が無い・照合の取得に失敗した、など曖昧なときは警告を残す。照合の失敗では `degraded` にしない
  - 廃止系・未施行（`UnEnforced`）の警告には影響しない

### Added

- `revision_metadata.latest_enforced_verified`（`get_article` / `get_evidence_bundle`）: `current_revision_status` が `PreviousEnforced` でも、照合で施行済みの最新版と確認できた場合だけ `true`。`current_revision_status` は e-Gov の値をそのまま返す

## [0.7.1] - 2026-10-04

### Fixed

- 省令の law_id（`322M40000100023` 労働基準法施行規則・`347M50002000032` 労働安全衛生規則・`350M50002000003` 雇用保険法施行規則）を、law_id を受け取る tool（`get_article` / `get_evidence_bundle` / `find_related_sources`、deprecated の `get_law`）が `validation` エラーで拒否していた。law_id 形式判定 `isEgovLawId` が法令種別コードを英字 2 文字に限定していたため、`resolve_law` が返した law_id をそのまま渡すと条文を取得できなかった。判定を `/^\d{3}[A-Z][A-Z0-9]{11}$/` に改め、未登録の `321CONSTITUTION` 等の形式も受け付ける（upstream `kentaroajisaka/labor-law-mcp` da2e35c と同じ修正）

### Changed

- （データ）bundled law index の `GENERATED_AT` を `2026-10-04` に更新。`verify:egov` で全 40 法令の現存性・正式名称を live e-Gov と照合した裏付けの上で再スタンプ（メタデータの現在性を保証。条文改正の反映は非保証）。0.7.0 では生成から 60 日を超え、e-Gov 系 tool の応答に `BUNDLED_INDEX_AGED` が付いていた
- （テスト）freshness 系の 4/1・10/1 境界跨ぎテストの現在時刻を固定日付から `GENERATED_AT_ISO` 由来へ変更。境界を越える `GENERATED_AT` 更新でテストが赤化しないようにした

## [0.7.0] - 2026-10-04

### Changed

- **MCP 2026-07-28 に対応**。SDK を v1 `@modelcontextprotocol/sdk` から v2 `@modelcontextprotocol/server` `^2.3.0` へ移行し、stdio の起動を `serveStdio` に切り替えた。接続の最初のメッセージで世代を判定し、2026-07-28（`server/discover`、stateless、`resultType`・`ttlMs`/`cacheScope` 付き応答、結果 `_meta` の `serverInfo`）と従来の 2025 系（`initialize`）の両方に応答する。ツール・リソース・プロンプトの外形と `instructions` は両世代で同一
  - プロンプト登録を廃止 API `server.prompt()` から `registerPrompt`（`argsSchema: z.object(...)`）へ
  - `overrides` を全撤去: v2 server パッケージは HTTP 系依存（hono / express 等）を持たず、pin 対象が依存ツリーから消えた
- （依存）`@modelcontextprotocol/sdk` を `^1.26.0`（実体 `1.29.0`）→ `^1.32.0` へ更新。テストが依存する private field（`server.server._requestHandlers` / `_instructions`）が 1.32.0 でも同名で存在することを確認し、`MCP_SDK_PINNED_VERSION` を `1.32.0` へ追従。src のコード変更なし
  - `overrides` は据え置き: SDK 1.32.0 の宣言 range（`hono ^4.11.4`、`@hono/node-server ^1.19.9 || ^2.0.5`、`express-rate-limit ^8.2.1`）は依然 override の下限を下回るため撤去条件を満たさない
- （依存）`npm audit` の 10 件（high 4 / moderate 5 / low 1）を解消。新たに公表された advisory が既存 `overrides` の下限を上回ったため、下限を patched 版へ引き上げ: `hono` `^4.13.12`、`@hono/node-server` `^1.19.17`、`fast-uri` `^3.1.8`、`qs` `^6.16.0`、`ip-address` `^10.7.3`、`express-rate-limit` `^8.5.2`。`body-parser` `^2.3.0` を override に追加（その後 v2 SDK 移行で `overrides` は全撤去）。devDeps の `vitest` を `^4.1.11` へ（`@vitest/mocker` の path traversal 対応）

### Removed

- 定期 observability レポーター（`startObservabilityReporter`）を削除。`logging` capability 未宣言のため `sendLoggingMessage` は SDK 内で no-op となり、一度も送信されていなかった。同じ情報は `get_observability_snapshot` ツールで取得できる
- 起動時の鮮度警告の MCP logging 送信を削除（同じく no-op だった）。stderr 出力と tool 応答の `warnings[]` は従来どおり

## [0.6.0] - 2026-07-13

### Changed

- （依存）major を一括更新: `zod` `^3.23.8` → `^4.4.3`（prod）、`typescript` `^5.7.0` → `^7.0.2`、`@types/node` `^20` → `^26.1.1`、`tsx` `^4.21.0` → `^4.23.0`（devDeps）。`vitest` は range 内で `4.1.10` へ。`@modelcontextprotocol/sdk` は `^1.26.0` のまま（既に range 内最新 `1.29.0` が入り `MCP_SDK_PINNED_VERSION` も追従済）
  - `zod` 4: 利用面が `z.string/number/object/enum/array/boolean/literal` と `.optional/.describe/.min/.max/.nullable` 中心で破壊的変更に非抵触。`z.record(z.string(), z.number())` は既に 2 引数形式、`ZodError` の `.errors`/`.issues` 依存も無し。SDK の zod peer は `^3.25 || ^4.0` で互換、SDK 内部の zod も `4.4.3` に dedupe。**src のコード変更なしで移行完了**
  - `typescript` 7（native compiler）: 自動 `@types` 取り込みが TS5 と異なり `node` グローバル型を解決できず build が失敗したため、`tsconfig.json` に `compilerOptions.types: ["node"]` を明示追加して解消（本プロジェクトの `@types` は node のみ・tests は build 対象外ゆえ副作用なし）
  - `@types/node` 26: build / test とも通過。型（26）と実行環境保証の乖離は、下記の最低サポート Node 引き上げ（→ Node 24）で解消
- （サポート）最低サポート Node を `>=24` に引き上げ、EOL 済みの Node 18 / 20 と Maintenance LTS の 22 を対象外に。`package.json` に `engines.node: ">=24"` を新設し、CI matrix を `[20, 22, 24]` → `[24, 26]`（Active LTS + Current）、README バッジを `>=18` → `>=24` へ更新。`@types/node` 26 の型と実際にテスト・保証する実行環境を一致させるための整合（Node 20 は 2026-03-24 EOL）。**最低 Node の引き上げは実質 breaking** ゆえ、次リリースは minor 以上を推奨
- （データ）bundled law index の `GENERATED_AT` を `2026-07-13` に更新。`verify:egov` で全法令の現存性・正式名称を live e-Gov と照合した裏付けの上で再スタンプ（メタデータの現在性を保証。条文改正の反映は非保証）。freshness 系テストの時刻基準を追従
- （データ）内部 registry を live e-Gov と照合して是正: 船員保険法の `law_id` を `414AC0000000073`（誤・平成14）から `314AC0000000073`（正・昭和14）へ修正し、e-Gov に存在しない「労働基準法施行令」（`322CO0000000300`）を削除（同法の施行規則 `322M40000100023` は既に収録済み）。同梱法令数 41 → 40
- （tool）freshness 警告 `BUNDLED_INDEX_AGED` の文言を是正: 条文本文は常に live 取得のため「本文の更新に再起動は不要」である旨を明記し、再起動が対象とするのは内蔵の法令リスト（法令名・略称→law_id の対応表）に限定。従来の「最新の法令改正を反映するには再起動」という過大約束を解消（version_info 導入と同じ category error の是正）

### Added

- `verify:egov`（`scripts/verify-egov-registry.ts`）: `LAW_ID_MAP` を live e-Gov API v2 と照合し `OK` / `NAME_MISMATCH` / `NOT_FOUND` / `ERROR` に分類する maintainer 用スクリプト（ネットワーク依存・CI/publish gate 対象外）。検証ロジックは `src/lib/indexes/registry-verification.ts` に分離し単体テスト対象
- （tool）`get_article` / `get_evidence_bundle` に版メタを追加: 既取得の e-Gov `revision_info`（**追加リクエストなし**）から、現行版の施行日・改正法・版固定 URL 等を機械可読な `revision_metadata` として、また誤帰属を避ける hedge（「※この施行日は法令全体の現行版を指し、引用した条文が改正されたとは限りません」）付きで人間可読 `version_info` に提供。非現行版・廃止/失効法令には警告 `LAW_NOT_CURRENTLY_ENFORCED` を付与。未施行改正の検知は別エンドポイント（`/law_revisions`）を要するため v2 backlog
- `get_article`: `include_pending_amendments`（既定 false）で e-Gov `/law_revisions` を追引きし、未施行の改正（施行予定日つき・段階施行の全ロードマップ）を `pending_amendments[]` として提供。誤帰属 hedge 付きの `UNENFORCED_AMENDMENT_PENDING` 警告を付与。取得失敗は graceful degrade（条文は返す・`status:'partial'`）

### Security

- `esbuild` の低 severity 脆弱性（GHSA-g7r4-m6w7-qqqr、Windows の dev server 限定の任意ファイル読取）を `npm audit fix` で `0.28.1` へ解消。本サーバーは vitest のテスト時にのみ esbuild を経由し dev server は使わないため実害は休眠だったが、`npm audit` を 0 件化

## [0.5.0] - 2026-06-10

### Added

- freshness 警告の env による抑止 (#1): 環境変数 `LABOR_LAW_MCP_SUPPRESS_FRESHNESS_WARNINGS` をセットすると、起動時通知 (`emitStartupWarnings`) と tool response への警告 merge (`getIndexWarningsForTool`) を両方 skip。過去事案の再現調査・バージョン固定の回帰環境・オフライン長期運用など、意図的に古い bundle を使う際の雑音を抑制（`''` / `0` / `false` / `no` / `off` 以外の値で有効）
- freshness 状態の MCP resource 公開 (#3): 読み取り専用リソース `mcp://jp-labor-evidence-mcp/status` を追加。各 index の `generated_at` / `freshness` / `bundled_age_days`、現在有効な `active_warnings`、`package_version`、`freshness_warnings_suppressed` を JSON で返す。reactive な警告経路に対し on-demand の proactive な状態照会を提供。警告抑止中でも `active_warnings` は真の状態を surface する

### Changed

- freshness 警告の日付を JST 表示に (#2): 生成日・最終同期・施行日を UTC 由来から `YYYY-MM-DD JST` 表記へ変更（対象ユーザの 日本の社労士 / HR にとって自然な表記）
- （内部）11 tool handler に重複していた envelope 警告の wire 変換を `toWireWarnings()` ヘルパへ集約 (#6)
- （内部）`DAY_MS` の 3 重定義と `bundled_age_days` の 2 経路を `src/lib/indexes/time.ts`（`DAY_MS` / `computeBundledAgeDays`）へ統合 (#5)
- （テスト）MCP SDK の private field アクセスを `tests/test-helpers/mcp-internals.ts` へ集約し、SDK バージョン不一致で赤化する version-guard を追加 (#7)

### Fixed

- freshness 警告の boundary note で、JST 真夜中（4/1 / 10/1 00:00 JST）の施行日が UTC 由来で 1 日前にズレて表示されていた off-by-one を是正 (#2)

## [0.4.2] - 2026-06-10

### Security

- `@modelcontextprotocol/sdk` の HTTP transport 系 transitive dependency に由来する `npm audit` 7 件（high 5 / moderate 2）を `package.json` の `overrides` で patched 版へ pin して解消
  - `hono` `^4.12.25` / `path-to-regexp` `^8.4.2` / `qs` `^6.15.2` / `ip-address` `^10.2.0` / `fast-uri` `^3.1.2` / `@hono/node-server` `^1.19.13` / `express-rate-limit` `^8.2.2`
  - 本サーバーは stdio transport 専用で `express` / `hono` の HTTP 経路は実行時に呼ばれないため実害は休眠だが、audit ノイズを除去。全 override は同一 major 内の patched 版で親パッケージの範囲制約と両立
  - `overrides` は SDK が将来これらの dep を patched 版へ bump したら撤去すべき暫定措置

### Changed

- （CI）GitHub Actions を導入: `ci.yml`（PR / push で Node 20/22/24 マトリクスの test + build + pack）と、OIDC Trusted Publishing による `release.yml`（version bump が main に乗ると自動 publish + tag + GitHub release）
- （テスト）freshness 依存テスト（`tool-wire-contract` / `find-related-sources`）の実時刻結合を fake-timer 固定化し、`GENERATED_AT` から 60 日経過で再赤化する time-bomb を解消

## [0.4.1] - 2026-06-10

### Changed

- bundled law index の `GENERATED_AT` を `2026-06-10` に更新（再キュレーション）
  - 2026 年施行の法改正（在職老齢年金の支給停止基準引上げ、社会保険の適用拡大・106 万円の壁撤廃、カスタマーハラスメント対策の義務化、被扶養者認定の見直し等）はいずれも既存法令の改正で e-Gov law_id は不変。本 index は law_id マッピングのみを保持し条文は e-Gov から live 取得するため、law set は現行と確認のうえ再スタンプ
  - 経過 60 日超で発火していた `BUNDLED_INDEX_AGED` warning をリセット
- 開発依存を semver 範囲内で更新（`@types/node` 20.19.42 / `tsx` 4.22.4 / `vitest` 4.1.8）。`package.json` の range は変更なし
- freshness 系テストの時刻基準を単一の `GENERATED_AT_ISO` に一本化し、今後の `GENERATED_AT` 更新への追従を 1 行に簡素化

## [0.4.0] - 2026-04-26

### Added

- bundled law registry に **calendar-aware boundary check** を追加
  - 直近の 4/1 / 10/1 (JST) 施行境界を `GENERATED_AT` が跨いでいる場合、60日経過していなくても `BUNDLED_INDEX_AGED` warning を発火
  - warning message に「直近の労働法令改正施行日 YYYY-MM-DD を跨いでいる」旨を追記
- 新規 helper `getMostRecentLawRevisionBoundaryMs(now)` を `src/lib/indexes/freshness-warnings.ts` に追加
  - `now` 時点での直近 4/1 / 10/1 JST 00:00 を UTC ms で返す純粋関数
  - 境界 semantic は `<= now`、上流の判定は `generatedMs < boundary` の strict less-than で `equals` を「跨いでいない」として扱う

## [0.3.0] - 2026-04-25

### Changed

- egov bundled index は freshness モデルから除外し、`freshness: 'unknown'` を返すよう変更
- `STALE_INDEX` degraded reason は runtime index (mhlw/jaish) のみで発火するよう整理
- server の `instructions` に freshness warnings の扱い方ガイダンスを追記
- SPEC.md の freshness 関連記述を実装実態に揃えて更新

### Added

- bundled law registry が 60 日を超えた場合の warning を emit
  - startup 時に MCP logging (`level: warning`) + stderr で一次通知
  - egov を消費する全 tool の response `warnings[]` に毎回 merge
- `search_mhlw_tsutatsu` / `search_jaish_tsutatsu` 等 mhlw/jaish 消費 tool の response に、runtime index が stale の際の warnings を同梱
- `IndexSnapshotMeta.bundled_age_days` を egov 向けに露出、`get_observability_snapshot` に反映

### Internal

- 新規 helper `src/lib/indexes/freshness-warnings.ts`

## [0.2.1] - 2026-04-03

### Fixed

- `get_evidence_bundle` の表示文に主条文全文を含めるよう修正
- `find_related_sources` の検索キーワード生成を強化
- 労基法第36条で `36協定` / `時間外労働` / `休日労働` を補助キーワードとして補完

### Changed

- 関連する回帰テストを追加・更新

## [0.2.0] - 2026-04-02

### Added

- `jp-labor-evidence-mcp` として初回公開
- `resolve_law` / `get_article` / `get_evidence_bundle` / `find_related_sources` / `diff_revision` を追加
- structured tool contract、observability、internal index、sync 基盤を導入

### Changed

- README と repository metadata を公開向けに整理
