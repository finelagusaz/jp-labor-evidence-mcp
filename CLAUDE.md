# CLAUDE.md

## Project

MCP server providing primary-source Japanese labor law evidence (法令、行政通達、判例) to LLMs.
- npm: `jp-labor-evidence-mcp`（version は package.json 参照）、stdio transport
- MCP SDK v2（`@modelcontextprotocol/server`）。`serveStdio` で 2026-07-28（`server/discover`）と 2025 系（`initialize`）の両世代を同一 factory で配信
- Target clients: Claude Desktop / Claude Code via `npx -y jp-labor-evidence-mcp`
- Target users: 社労士 / HR / legal advisers (日本語が一次)

## Commands

- `npm run dev` — tsx で `src/index.ts` を実行（hot iteration）
- `npm test` / `npm run test:watch` — vitest
- `npm run build` — tsc → `dist/`
- `npm run release:check` — test + build + pack:dry-run、npm publish 前の必須 gate
- `npm run sync:indexes[:full|:incremental]` — 内部 index の更新 script（**ネットワーク取得なし**。registry の bundled/seed を gitignored runtime store へ再シリアライズするだけ）
- `npm run verify:egov` — `LAW_ID_MAP` を live e-Gov と照合（**ネットワーク依存・CI/publish gate 対象外・maintainer 用**）。全件 OK なら exit 0。`GENERATED_AT` bump 前の裏付けに使う
- CI: `.github/workflows/ci.yml`（PR/push で Node 24/26 の test+build+pack）+ `release.yml`（自動 publish。下記 Release workflow 参照）

## Architecture

- `src/index.ts` — bootstrap（`initializeIndexes` → `serveStdio(() => createServer())` → `emitStartupWarnings`）。`createServer` は接続ごとに呼ばれうるので、プロセス単位の初期化は factory の外に置く。serveStdio は factory を遅延呼び出しするため、起動時に一度 `createServer()` して登録エラーを fail-fast させている
- `src/server.ts` — `McpServer` factory、`instructions` field に LLM 向けガイダンス
- `src/tools/*.ts` — 13 個の MCP tool（うち `get_law` は deprecated）。各 handler は envelope 構築時に warnings を merge
- `src/lib/indexes/` — egov / mhlw / jaish 内部索引（bundled vs runtime）
- `src/lib/indexes/freshness-warnings.ts` — `getIndexWarningsForTool(sources)` ヘルパ
- `src/lib/services/` — upstream API 呼び出しと normalize
- `tests/` — vitest、fixture は `tests/fixtures/`

## Key patterns

- **Freshness model**: bundled (`egov`) は `freshness: 'unknown'` 固定 + `bundled_age_days` で age 露出。runtime (`mhlw`, `jaish`) は `inferFreshness(generated_at, now)` で 7日 TTL
- **Tool warnings**: 各 tool handler は `getIndexWarningsForTool(['egov' | 'mhlw' | 'jaish'])` を呼んで envelope の `warnings[]` (型: `WarningMessage[]` = `{code, message}`) に merge。`source` field の strip は `toWireWarnings()`（同ファイル）に集約済み。handler は `toWireWarnings(getIndexWarningsForTool([...]))` の形で使う
- **`now` 注入**: 時刻依存 helper は `now: number = Date.now()` を引数化。`inferFreshness`, `getBundledIndexWarnings` 等が pattern を踏襲
- **Compute before await**: 検索 tool で `recordSuccess` が registry の `generated_at` を上書きするため、`freshnessWarnings` は service 呼出前に計算

## Testing patterns

- 時刻依存: `vi.useFakeTimers()` + `vi.setSystemTime(new Date(...))` + `afterEach(() => vi.useRealTimers())`
- module-load-time の挙動を test: `vi.resetModules()` + 動的 `import()`（参考: [tests/egov-index.test.ts](tests/egov-index.test.ts)）
- **file-level `vi.mock` は `vi.resetModules()` で消えない**: 同一ファイル内で一部の test だけ実装を使いたい場合、`resetModules()` 後の動的 `import()` にも mock が効き続ける。`vi.doUnmock(path)` → `vi.resetModules()` → 動的 `import()` の順で解除する。`vi.unmock` はホイストされてファイル全体の mock を無効化するので使わない（参考: [tests/get-article-revision.test.ts](tests/get-article-revision.test.ts)）
- Tool integration test: [tests/test-helpers/mcp-internals.ts](tests/test-helpers/mcp-internals.ts) が公開 API（`Client` + `InMemoryTransport`）で server に接続する。tool 呼び出しは `callTool(server, name, args)`、instructions は `await getServerInstructions(server)`。`server.connect(InMemoryTransport)` は 2025 系の wire のみ。2026-07-28 経路は [tests/modern-protocol.test.ts](tests/modern-protocol.test.ts) が `serveStdio(factory, { transport })` に `InMemoryTransport` を渡して生 JSON-RPC で検証する（要求の `_meta` に `io.modelcontextprotocol/protocolVersion` 必須。無いと 2025 系扱いで `-32601`）。SDK を bump すると [tests/mcp-internals.test.ts](tests/mcp-internals.test.ts) の version-guard（server / client / core の 3 つ）が赤化するので、挙動を再確認して `MCP_SDK_PINNED_VERSION` を更新する。server と client は core を exact pin するので常に同じ版へそろえる
- Registry seed test: `indexMetadataRegistry.register({...})` で fake meta を直接投入
- 通達検索（`searchMhlwTsutatsu` / `searchJaishTsutatsu`）を実際に通るテストは、describe の先頭で `useTempIndexDir()`（[tests/test-helpers/temp-index-dir.ts](tests/test-helpers/temp-index-dir.ts)）を呼ぶ。検索は反映前にディスクの索引を取り込むので、リポジトリ内の索引を使うと前回の実行の内容で結果が変わりうる

## Gotchas

- **永続 disk state**: `.jp-labor-evidence-indexes/`（gitignored）は、手元で server や live 確認のスクリプトを動かしたときの runtime 索引。テストはこのディレクトリを使わない（空の状態から全テストを実行しても作られないことを 2026-10-06 に確認）。保守用の `npm run sync:indexes` が promotion error（`ENTRY_COUNT_DROP_TOO_LARGE` など）で止まったときや、手元の索引を初期化したいときは `rm -rf .jp-labor-evidence-indexes`
- **live 確認のスクリプトは `initializeIndexes()` を先に呼ぶ**: `createServer()` だけでは起動時の索引の読み込みを通らず、本番と違う状態（メモリが空）で動く
- **egov GENERATED_AT**: [src/lib/indexes/egov-index.ts:10](src/lib/indexes/egov-index.ts#L10) の literal。bundled 法令データの生成時刻、コード更新時に手動で書き換える
  - **bump 時は freshness 結合テストも同じ日付へ追従必須**: [tests/freshness-warnings.test.ts](tests/freshness-warnings.test.ts) の `GENERATED_AT_ISO`、[tests/tool-freshness-warnings.test.ts](tests/tool-freshness-warnings.test.ts) の `GENERATED_AT_MS`、[tests/egov-index.test.ts](tests/egov-index.test.ts) の `setSystemTime`、[tests/status-resource.test.ts](tests/status-resource.test.ts) の `GENERATED_AT_ISO`。怠ると `BUNDLED_INDEX_AGED` の発火位置がズレて test が赤化する
  - `tests/tool-wire-contract.test.ts` / `tests/find-related-sources-tool.test.ts` / `tests/get-article-revision.test.ts` は `vi.setSystemTime(new Date(getEgovIndexMeta().generated_at))` で egov を常に fresh 固定（#14 で実時刻 time-bomb を解消）。生成時刻を production と同一ソースから導出するため GENERATED_AT bump 追従は不要
- **CHANGELOG date**: 自動 publish 化により placeholder 運用は**廃止**。`## [x.y.z] - YYYY-MM-DD` は **version bump PR の時点で実日付を記入**する（merge = release のため）
- **Version bump**: package.json + `src/server.ts` の `SERVER_VERSION` 定数を更新し、`npm install` で `package-lock.json` の version も同期（計 3 ファイル）
- **MCP logging は使わない**: 2026-07-28 で Logging は非推奨（SEP-2577）で、request 外の `notifications/message` は送れない。運用ログは stderr（`console.error`）へ。`logging` capability も宣言しない
- **Issue tracker**: `bugs.url` は `finelagusaz/jp-labor-evidence-mcp/issues`。upstream `kentaroajisaka/labor-law-mcp` には issue を立てない

## Release workflow

リリースは **GitHub Actions による自動 publish**（OIDC Trusted Publishing、`release.yml`）。npm token も 2FA も不要で provenance 署名付き。

1. version bump（package.json + `src/server.ts` の `SERVER_VERSION`）+ `npm install` で `package-lock.json` 同期
2. CHANGELOG に `## [x.y.z] - YYYY-MM-DD` を**実日付**で追記
3. PR 作成 → `ci.yml`（Node 24/26 で test+build+pack）が gate
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
