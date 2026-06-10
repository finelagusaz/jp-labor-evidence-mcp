# CLAUDE.md

## Project

MCP server providing primary-source Japanese labor law evidence (法令、行政通達、判例) to LLMs.
- npm: `jp-labor-evidence-mcp`（version は package.json 参照）、stdio transport
- Target clients: Claude Desktop / Claude Code via `npx -y jp-labor-evidence-mcp`
- Target users: 社労士 / HR / legal advisers (日本語が一次)

## Commands

- `npm run dev` — tsx で `src/index.ts` を実行（hot iteration）
- `npm test` / `npm run test:watch` — vitest
- `npm run build` — tsc → `dist/`
- `npm run release:check` — test + build + pack:dry-run、npm publish 前の必須 gate
- `npm run sync:indexes[:full|:incremental]` — 内部 index の更新 script（**ネットワーク取得なし**。registry の bundled/seed を gitignored runtime store へ再シリアライズするだけ）
- CI: `.github/workflows/ci.yml`（PR/push で Node 20/22/24 の test+build+pack）+ `release.yml`（自動 publish。下記 Release workflow 参照）

## Architecture

- `src/index.ts` — bootstrap (stdio transport + observability reporter + emitStartupWarnings)
- `src/server.ts` — `McpServer` factory、`instructions` field に LLM 向けガイダンス
- `src/tools/*.ts` — 12 個の MCP tool（うち `get_law` は deprecated）。各 handler は envelope 構築時に warnings を merge
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
  - **bump 時は freshness 結合テストも同じ日付へ追従必須**: [tests/freshness-warnings.test.ts](tests/freshness-warnings.test.ts) の `GENERATED_AT_ISO`、[tests/tool-freshness-warnings.test.ts](tests/tool-freshness-warnings.test.ts) の `GENERATED_AT_MS`、[tests/egov-index.test.ts](tests/egov-index.test.ts) の `setSystemTime`。怠ると `BUNDLED_INDEX_AGED` の発火位置がズレて test が赤化する
  - `tests/tool-wire-contract.test.ts` / `tests/find-related-sources-tool.test.ts` は `vi.setSystemTime(new Date(getEgovIndexMeta().generated_at))` で egov を常に fresh 固定（#14 で実時刻 time-bomb を解消）。生成時刻を production と同一ソースから導出するため GENERATED_AT bump 追従は不要
- **CHANGELOG date**: 自動 publish 化により placeholder 運用は**廃止**。`## [x.y.z] - YYYY-MM-DD` は **version bump PR の時点で実日付を記入**する（merge = release のため）
- **Version bump**: package.json + `src/server.ts` の `version: '...'` を更新し、`npm install` で `package-lock.json` の version も同期（計 3 ファイル）
- **deps overrides**: `package.json` の `overrides` は `@modelcontextprotocol/sdk` 由来 transitive 脆弱性の暫定 pin（hono / path-to-regexp / qs / ip-address / fast-uri / @hono/node-server / express-rate-limit）。stdio 専用ゆえ実害は休眠だが audit ノイズ除去のため。**SDK がこれらを patched 版へ bump したら撤去・再評価**する
- **Issue tracker**: `bugs.url` は `finelagusaz/jp-labor-evidence-mcp/issues`。upstream `kentaroajisaka/labor-law-mcp` には issue を立てない

## Release workflow

リリースは **GitHub Actions による自動 publish**（OIDC Trusted Publishing、`release.yml`）。npm token も 2FA も不要で provenance 署名付き。

1. version bump（package.json + `src/server.ts`）+ `npm install` で `package-lock.json` 同期
2. CHANGELOG に `## [x.y.z] - YYYY-MM-DD` を**実日付**で追記
3. PR 作成 → `ci.yml`（Node 20/22/24 で test+build+pack）が gate
4. main にマージ → `release.yml` が `package.json` 変更で発火。未公開 version のみ `npm publish --provenance` + `vX.Y.Z` タグ + GitHub release を自動生成
5. `npm view jp-labor-evidence-mcp version dist-tags` と `dist.attestations`（provenance）で確認

- npm 側 **Trusted Publisher は設定済**（repo `finelagusaz/jp-labor-evidence-mcp` / workflow `release.yml`、2026-06-10）
- `release:check`（test+build+pack）は `prepublishOnly` と CI の両方で走る必須 gate
- **fallback（手動）**: npm アカウントが publish 時 2FA を要求するため、手動 publish 時は人手で `! npm publish` + browser 認証が必要

## Documentation

- `SPEC.md` — 包括的な要件・設計ドキュメント（Phase 0〜4.x）
- `docs/superpowers/specs/` — 機能ごとの設計仕様書
- `docs/superpowers/plans/` — 実装計画（TDD task 単位）
- `CHANGELOG.md` — Keep a Changelog 風、リリース毎に追記
