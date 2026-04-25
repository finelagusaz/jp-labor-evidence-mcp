# CLAUDE.md

## Project

MCP server providing primary-source Japanese labor law evidence (法令、行政通達、判例) to LLMs.
- npm: `jp-labor-evidence-mcp` (currently v0.3.0)、stdio transport
- Target clients: Claude Desktop / Claude Code via `npx -y jp-labor-evidence-mcp`
- Target users: 社労士 / HR / legal advisers (日本語が一次)

## Commands

- `npm run dev` — tsx で `src/index.ts` を実行（hot iteration）
- `npm test` / `npm run test:watch` — vitest
- `npm run build` — tsc → `dist/`
- `npm run release:check` — test + build + pack:dry-run、npm publish 前の必須 gate
- `npm run sync:indexes[:full|:incremental]` — 内部 index の更新 script

## Architecture

- `src/index.ts` — bootstrap (stdio transport + observability reporter + emitStartupWarnings)
- `src/server.ts` — `McpServer` factory、`instructions` field に LLM 向けガイダンス
- `src/tools/*.ts` — 11 個の MCP tool。各 handler は envelope 構築時に warnings を merge
- `src/lib/indexes/` — egov / mhlw / jaish 内部索引（bundled vs runtime）
- `src/lib/indexes/freshness-warnings.ts` — `getIndexWarningsForTool(sources)` ヘルパ
- `src/lib/services/` — upstream API 呼び出しと normalize
- `tests/` — vitest、fixture は `tests/fixtures/`

## Key patterns

- **Freshness model**: bundled (`egov`) は `freshness: 'unknown'` 固定 + `bundled_age_days` で age 露出。runtime (`mhlw`, `jaish`) は `inferFreshness(generated_at, now)` で 7日 TTL
- **Tool warnings**: 各 tool handler は `getIndexWarningsForTool(['egov' | 'mhlw' | 'jaish'])` を呼んで envelope の `warnings[]` (型: `WarningMessage[]` = `{code, message}`) に merge。`source` field を `.map(({code, message}) => ({code, message}))` で strip
- **`now` 注入**: 時刻依存 helper は `now: number = Date.now()` を引数化。`inferFreshness`, `getBundledIndexWarnings` 等が pattern を踏襲
- **Compute before await**: 検索 tool で `recordSuccess` が registry の `generated_at` を上書きするため、`freshnessWarnings` は service 呼出前に計算

## Testing patterns

- 時刻依存: `vi.useFakeTimers()` + `vi.setSystemTime(new Date(...))` + `afterEach(() => vi.useRealTimers())`
- module-load-time の挙動を test: `vi.resetModules()` + 動的 `import()`（参考: [tests/egov-index.test.ts](tests/egov-index.test.ts)）
- Tool integration test: `server.server._requestHandlers.get('tools/call')` で handler 直叩き（MCP SDK 1.29.0 internal、Issue #7 で代替経路追跡中）
- Registry seed test: `indexMetadataRegistry.register({...})` で fake meta を直接投入

## Gotchas

- **永続 disk state**: `.jp-labor-evidence-indexes/` (gitignored) が `npm test` 失敗の原因に。`ENTRY_COUNT_DROP_TOO_LARGE` 系 promotion error が出たら `rm -rf .jp-labor-evidence-indexes` で復旧
- **egov GENERATED_AT**: [src/lib/indexes/egov-index.ts:9](src/lib/indexes/egov-index.ts#L9) の literal。bundled 法令データの生成時刻、コード更新時に手動で書き換える
- **CHANGELOG date**: `## [x.y.z] - YYYY-MM-DD` の placeholder は **release engineer が npm publish 時に置換**
- **Version bump**: package.json + `src/server.ts` の `version: '...'` の 2 箇所、必ず両方更新
- **Issue tracker**: `bugs.url` は `finelagusaz/jp-labor-evidence-mcp/issues`。upstream `kentaroajisaka/labor-law-mcp` には issue を立てない

## Release workflow

1. PR review pass → main にマージ
2. CHANGELOG の `YYYY-MM-DD` を実日付に置換
3. `npm run release:check` で最終検証
4. `npm publish` （`prepublishOnly` で自動実行）

## Documentation

- `SPEC.md` — 包括的な要件・設計ドキュメント（Phase 0〜4.x）
- `docs/superpowers/specs/` — 機能ごとの設計仕様書
- `docs/superpowers/plans/` — 実装計画（TDD task 単位）
- `CHANGELOG.md` — Keep a Changelog 風、リリース毎に追記
