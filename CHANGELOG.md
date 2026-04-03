# Changelog

このプロジェクトの主な変更を記録します。

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
