# Changelog

このプロジェクトの主な変更を記録します。

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
