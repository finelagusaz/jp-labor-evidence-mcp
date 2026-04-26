# Changelog

このプロジェクトの主な変更を記録します。

## [0.4.0] - YYYY-MM-DD

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
