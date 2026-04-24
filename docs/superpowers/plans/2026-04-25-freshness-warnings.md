# Freshness Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bundled egov index を freshness モデルから除外し（β）、bundled 60日超と runtime 7日超に対して利用者向け日本語 warning を MCP logging / tool response の両チャネルで通知する。

**Architecture:** 新規 pure helper `src/lib/indexes/freshness-warnings.ts` が warning の生成を一手に引き受け、各 tool handler は envelope 組み立て時に `getIndexWarningsForTool(sources)` を呼んで `warnings[]` に merge する。起動時には `src/index.ts` から `emitStartupWarnings(server)` を呼び、MCP logging notification と stderr に一次通知する。egov の `freshness` は `'unknown'` に固定し、代わりに `bundled_age_days` を露出。server の `instructions` に LLM 向けガイダンスを追記。

**Tech Stack:** TypeScript (ES modules)、Vitest、@modelcontextprotocol/sdk 1.29.0、zod。仕様: `docs/superpowers/specs/2026-04-25-freshness-warnings-design.md`。

---

## ファイル構成

### Create

- `src/lib/indexes/freshness-warnings.ts` — helper モジュール (`BUNDLED_AGE_THRESHOLD_DAYS`、`FreshnessWarning`、`getBundledIndexWarnings`、`getRuntimeIndexWarnings`、`getIndexWarningsForTool`、`emitStartupWarnings`)
- `tests/freshness-warnings.test.ts` — helper の単体テスト・smoke テスト
- `tests/tool-freshness-warnings.test.ts` — 各 tool response に warnings が merge されることの統合テスト

### Modify

- `src/lib/indexes/types.ts` — `IndexSnapshotMeta` に `bundled_age_days?: number` 追加
- `src/lib/indexes/egov-index.ts` — β 対応（`freshness: 'unknown'` 固定、`bundled_age_days` を meta に付与する wrapper）
- `src/tools/resolve-law.ts` / `search-law.ts` / `get-law.ts` / `get-article.ts` / `diff-revision.ts` — `['egov']` 依存の warning merge
- `src/tools/search-mhlw-tsutatsu.ts` / `get-mhlw-tsutatsu.ts` — `['mhlw']` 依存
- `src/tools/search-jaish-tsutatsu.ts` / `get-jaish-tsutatsu.ts` — `['jaish']` 依存
- `src/tools/find-related-sources.ts` / `get-evidence-bundle.ts` — `['egov', 'mhlw', 'jaish']` 依存
- `src/tools/get-observability-snapshot.ts` — schema に `bundled_age_days` 追加、Markdown 整形にトークン追加
- `src/server.ts` — `instructions` に freshness warnings ガイダンス追記
- `src/index.ts` — `main()` に `emitStartupWarnings(server)` 追加
- `tests/egov-index.test.ts` — β 後の assertion（`freshness: 'unknown'`、`bundled_age_days`）
- `SPEC.md` — §8/§13.3/§14.2.6 の drift 修正、新 §14.x 追加
- `CHANGELOG.md` — 0.3.0 エントリ追加
- `package.json` — version 0.2.1 → 0.3.0

---

## Task 1: β 対応（egov を freshness モデルから除外し bundled_age_days を露出）

**Files:**
- Modify: `src/lib/indexes/types.ts`
- Modify: `src/lib/indexes/egov-index.ts`
- Modify: `tests/egov-index.test.ts`

- [ ] **Step 1: test を先に更新して failing にする**

`tests/egov-index.test.ts` 内の 1 つ目の test を以下のように変更：

```ts
it('略称を内部索引から resolved できる', async () => {
  const { resolveLawFromEgovIndex } = await import('../src/lib/indexes/egov-index.js');
  const result = resolveLawFromEgovIndex('労基法');

  expect(result.resolution).toBe('resolved');
  expect(result.candidates[0]?.lawId).toBe('322AC0000000049');
  expect(result.meta.freshness).toBe('unknown');
  expect(result.meta.bundled_age_days).toBe(0);
});
```

- [ ] **Step 2: テストを走らせ、failing を確認**

```bash
npx vitest run tests/egov-index.test.ts
```

Expected: 1 failed (`expected 'fresh' to be 'unknown'`)

- [ ] **Step 3: `IndexSnapshotMeta` に `bundled_age_days` フィールドを追加**

`src/lib/indexes/types.ts` で `IndexSnapshotMeta` の型定義に追記。正確な位置は既存フィールド末尾（`rollback_count?: number;` の後など optional フィールド群）：

```ts
export type IndexSnapshotMeta = {
  source: IndexSource;
  generated_at: string;
  // ... 既存フィールド ...
  rollback_count?: number;
  bundled_age_days?: number;
};
```

- [ ] **Step 4: `egov-index.ts` を β に対応させる**

`src/lib/indexes/egov-index.ts` の以下を修正：

(a) ファイル上部に定数を追加：

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
```

(b) `DEFAULT_EGOV_INDEX_META` の `freshness` を `'unknown'` 固定にする（`inferFreshness(GENERATED_AT)` の行を置換）：

```ts
const DEFAULT_EGOV_INDEX_META: IndexSnapshotMeta = {
  source: 'egov',
  generated_at: GENERATED_AT,
  last_success_at: GENERATED_AT,
  freshness: 'unknown',
  entry_count: DEFAULT_LAW_INDEX_ENTRIES.length,
  coverage_ratio: 1,
  covered_years: [],
  query_hit_rate: 0,
  last_sync_scope: 'bundled_registry',
  cold_start_minimum_scope: 'bundled_registry',
};
```

(c) `withBundledAge` helper を追加（`export` の前、module private）：

```ts
function withBundledAge(meta: IndexSnapshotMeta): IndexSnapshotMeta {
  if (meta.source !== 'egov') return meta;
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return meta;
  return {
    ...meta,
    bundled_age_days: Math.floor((Date.now() - generatedMs) / DAY_MS),
  };
}
```

(d) 公開関数を wrapper 経由に変更：

```ts
export function getEgovIndexMeta(): IndexSnapshotMeta {
  return withBundledAge(egovIndexMeta);
}

export function getBundledEgovIndexMeta(): IndexSnapshotMeta {
  return withBundledAge(DEFAULT_EGOV_INDEX_META);
}

export function getEgovIndexSnapshot(): SerializedLawIndex {
  return {
    meta: withBundledAge(egovIndexMeta),
    entries: lawIndexEntries,
  };
}
```

(e) `resolveLawFromEgovIndex` 内の `meta: egovIndexMeta` 全箇所を `meta: withBundledAge(egovIndexMeta)` に置換（not_found、ambiguous、resolved の各分岐）。同様に `searchEgovIndex` など meta を返す全箇所。

(f) `persistEgovIndex` 内の `freshness: inferFreshness(egovIndexMeta.generated_at)` を `freshness: 'unknown'` に置換：

```ts
export function persistEgovIndex(): void {
  const promoted = promoteLawIndexSnapshot('egov', {
    meta: {
      ...egovIndexMeta,
      entry_count: lawIndexEntries.length,
      freshness: 'unknown',
    },
    entries: lawIndexEntries,
  });
  egovIndexMeta = {
    ...egovIndexMeta,
    ...promoted.meta,
  };
  indexMetadataRegistry.register(egovIndexMeta);
}
```

(g) unused になる `inferFreshness` の import を削除：

```diff
-import { indexMetadataRegistry, inferFreshness } from './index-metadata.js';
+import { indexMetadataRegistry } from './index-metadata.js';
```

- [ ] **Step 5: テストを再実行し pass を確認**

```bash
npx vitest run tests/egov-index.test.ts
```

Expected: 3 passed。

- [ ] **Step 6: 既存スイート全体を回して回帰がないことを確認**

```bash
npm test
```

Expected: 全 85 tests pass。

- [ ] **Step 7: 型チェック**

```bash
npm run build
```

Expected: exit 0、エラーなし。

- [ ] **Step 8: Commit**

```bash
git add src/lib/indexes/types.ts src/lib/indexes/egov-index.ts tests/egov-index.test.ts
git commit -m "$(cat <<'EOF'
Exclude egov bundled index from freshness model

Set egov freshness to 'unknown' unconditionally and expose a runtime-computed
bundled_age_days field on IndexSnapshotMeta. Runtime indexes (mhlw, jaish)
retain the existing fresh/stale/unknown judgment via inferFreshness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `freshness-warnings.ts` helper モジュール（TDD）

**Files:**
- Create: `src/lib/indexes/freshness-warnings.ts`
- Create: `tests/freshness-warnings.test.ts`

- [ ] **Step 1: failing test を書く**

`tests/freshness-warnings.test.ts` を新規作成：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_AT_MS = Date.parse('2026-04-02T00:00:00.000Z');

describe('freshness-warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GENERATED_AT_MS));
    indexMetadataRegistry.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getBundledIndexWarnings', () => {
    it('59日以下では空配列を返す', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 59 * DAY;
      expect(getBundledIndexWarnings(now)).toEqual([]);
    });

    it('60日ちょうどでは空配列を返す（閾値は strict greater）', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 60 * DAY;
      expect(getBundledIndexWarnings(now)).toEqual([]);
    });

    it('60日を超えると BUNDLED_INDEX_AGED を返す', async () => {
      const { getBundledIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getBundledIndexWarnings(now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('BUNDLED_INDEX_AGED');
      expect(warnings[0]?.source).toBe('egov');
      expect(warnings[0]?.message).toContain('61 日');
      expect(warnings[0]?.message).toContain('再起動');
      expect(warnings[0]?.message).toContain('npm update -g jp-labor-evidence-mcp');
    });
  });

  describe('getRuntimeIndexWarnings', () => {
    it('registry に meta がない場合は空配列を返す', async () => {
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      expect(getRuntimeIndexWarnings('mhlw', GENERATED_AT_MS)).toEqual([]);
    });

    it('generated_at から 7日以内なら空配列を返す', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 6 * DAY;
      expect(getRuntimeIndexWarnings('mhlw', now)).toEqual([]);
    });

    it('generated_at から 7日を超えると RUNTIME_INDEX_STALE を返す（mhlw）', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getRuntimeIndexWarnings('mhlw', now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('RUNTIME_INDEX_STALE');
      expect(warnings[0]?.source).toBe('mhlw');
      expect(warnings[0]?.message).toContain('厚生労働省通達');
      expect(warnings[0]?.message).toContain('8日前');
      expect(warnings[0]?.message).toContain('再検索');
    });

    it('jaish にも同じ判定を適用する', async () => {
      indexMetadataRegistry.register({
        source: 'jaish',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getRuntimeIndexWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getRuntimeIndexWarnings('jaish', now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.source).toBe('jaish');
      expect(warnings[0]?.message).toContain('JAISH');
    });
  });

  describe('getIndexWarningsForTool', () => {
    it('egov のみ: bundled warning のみ返す', async () => {
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getIndexWarningsForTool(['egov'], now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('BUNDLED_INDEX_AGED');
    });

    it('mhlw のみ: mhlw stale のみ返す', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 8 * DAY;
      const warnings = getIndexWarningsForTool(['mhlw'], now);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe('RUNTIME_INDEX_STALE');
      expect(warnings[0]?.source).toBe('mhlw');
    });

    it('multi-source: 該当するものを順に合成する', async () => {
      indexMetadataRegistry.register({
        source: 'mhlw',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      indexMetadataRegistry.register({
        source: 'jaish',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 5,
      });
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 61 * DAY;
      const warnings = getIndexWarningsForTool(['egov', 'mhlw', 'jaish'], now);
      expect(warnings).toHaveLength(3);
      expect(warnings.map((w) => w.source)).toEqual(['egov', 'mhlw', 'jaish']);
    });

    it('全て fresh なら空配列', async () => {
      const { getIndexWarningsForTool } = await import('../src/lib/indexes/freshness-warnings.js');
      const now = GENERATED_AT_MS + 3 * DAY;
      expect(getIndexWarningsForTool(['egov'], now)).toEqual([]);
    });
  });

  describe('emitStartupWarnings', () => {
    it('aged なら sendLoggingMessage と console.error を呼ぶ', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 61 * DAY;

      await emitStartupWarnings({ sendLoggingMessage } as any, now);

      expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
      expect(sendLoggingMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          logger: 'jp-labor-evidence-mcp',
          data: expect.stringContaining('内蔵法令インデックス'),
        })
      );
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[jp-labor-evidence-mcp] WARNING'));

      stderrSpy.mockRestore();
    });

    it('aged でないなら何もしない', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn();
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 10 * DAY;

      await emitStartupWarnings({ sendLoggingMessage } as any, now);

      expect(sendLoggingMessage).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('sendLoggingMessage が reject しても throw しない', async () => {
      const { emitStartupWarnings } = await import('../src/lib/indexes/freshness-warnings.js');
      const sendLoggingMessage = vi.fn().mockRejectedValue(new Error('transport closed'));
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = GENERATED_AT_MS + 61 * DAY;

      await expect(emitStartupWarnings({ sendLoggingMessage } as any, now)).resolves.toBeUndefined();
      expect(stderrSpy).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });
  });
});
```

- [ ] **Step 2: テストを走らせ、failing を確認**

```bash
npx vitest run tests/freshness-warnings.test.ts
```

Expected: FAIL — モジュールが存在しない。

- [ ] **Step 3: `freshness-warnings.ts` を実装**

`src/lib/indexes/freshness-warnings.ts` を新規作成：

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from './egov-index.js';
import { indexMetadataRegistry, inferFreshness } from './index-metadata.js';
import type { IndexSource } from './types.js';

export const BUNDLED_AGE_THRESHOLD_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUNDLED_AGE_THRESHOLD_MS = BUNDLED_AGE_THRESHOLD_DAYS * DAY_MS;

export type FreshnessWarning = {
  code: 'BUNDLED_INDEX_AGED' | 'RUNTIME_INDEX_STALE';
  source: IndexSource;
  message: string;
};

const SOURCE_LABELS: Record<'mhlw' | 'jaish', string> = {
  mhlw: '厚生労働省通達',
  jaish: '中央労働災害防止協会（JAISH）判例・資料',
};

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function getBundledIndexWarnings(now: number = Date.now()): FreshnessWarning[] {
  const meta = getEgovIndexMeta();
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return [];
  const elapsedMs = now - generatedMs;
  if (elapsedMs <= BUNDLED_AGE_THRESHOLD_MS) return [];
  const ageDays = Math.floor(elapsedMs / DAY_MS);
  const message = `内蔵法令インデックスの生成から ${ageDays} 日経過しています（生成日: ${formatDate(generatedMs)}）。最新の法令改正を反映するには、Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動の場合は再起動で最新パッケージが自動取得されます）。グローバルインストール利用時は \`npm update -g jp-labor-evidence-mcp\` を実行してください。`;
  return [{ code: 'BUNDLED_INDEX_AGED', source: 'egov', message }];
}

export function getRuntimeIndexWarnings(
  source: 'mhlw' | 'jaish',
  now: number = Date.now()
): FreshnessWarning[] {
  const meta = indexMetadataRegistry.list().find((m) => m.source === source);
  if (!meta) return [];
  const freshness = inferFreshness(meta.generated_at, now);
  if (freshness !== 'stale') return [];
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return [];
  const ageDays = Math.floor((now - generatedMs) / DAY_MS);
  const label = SOURCE_LABELS[source];
  const message = `${label}のインデックスが古くなっています（最終同期: ${formatDate(generatedMs)}、${ageDays}日前）。同じキーワードで再検索すると最新の情報が反映されます。`;
  return [{ code: 'RUNTIME_INDEX_STALE', source, message }];
}

export function getIndexWarningsForTool(
  sources: ReadonlyArray<IndexSource>,
  now: number = Date.now()
): FreshnessWarning[] {
  const warnings: FreshnessWarning[] = [];
  for (const source of sources) {
    if (source === 'egov') {
      warnings.push(...getBundledIndexWarnings(now));
    } else {
      warnings.push(...getRuntimeIndexWarnings(source, now));
    }
  }
  return warnings;
}

export async function emitStartupWarnings(
  server: McpServer,
  now: number = Date.now()
): Promise<void> {
  const warnings = getBundledIndexWarnings(now);
  if (warnings.length === 0) return;
  for (const warning of warnings) {
    console.error(`[jp-labor-evidence-mcp] WARNING: ${warning.message}`);
    try {
      await server.sendLoggingMessage({
        level: 'warning',
        data: warning.message,
        logger: 'jp-labor-evidence-mcp',
      });
    } catch {
      // MCP client may not support logging capability; stderr already written
    }
  }
}
```

- [ ] **Step 4: テストを再実行し全 pass を確認**

```bash
npx vitest run tests/freshness-warnings.test.ts
```

Expected: all tests passed（13 件程度）。

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: build 成功、全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add src/lib/indexes/freshness-warnings.ts tests/freshness-warnings.test.ts
git commit -m "$(cat <<'EOF'
Add freshness-warnings helper module

New pure helper in src/lib/indexes/freshness-warnings.ts provides
getBundledIndexWarnings, getRuntimeIndexWarnings, getIndexWarningsForTool,
and emitStartupWarnings. Japanese user-facing messages and 60-day bundled
threshold. All entry points accept a now parameter for deterministic
testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: startup 配線（src/index.ts に `emitStartupWarnings` を呼ばせる）

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: `src/index.ts` の `main()` に emitStartupWarnings を追加**

```diff
 #!/usr/bin/env node

 import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 import { initializeIndexes } from './lib/indexes/bootstrap.js';
+import { emitStartupWarnings } from './lib/indexes/freshness-warnings.js';
 import { startObservabilityReporter } from './lib/observability-reporter.js';
 import { createServer } from './server.js';

 const server = createServer();

 async function main() {
   initializeIndexes();
   const transport = new StdioServerTransport();
   await server.connect(transport);
   startObservabilityReporter(server);
+  await emitStartupWarnings(server);
   console.error('jp-labor-evidence-mcp running on stdio');
 }
```

- [ ] **Step 2: build と既存テストで回帰がないか確認**

```bash
npm run build && npm test
```

Expected: build 成功、全 tests pass。

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
Wire emitStartupWarnings into server bootstrap

After the observability reporter starts, run a one-shot bundled-age
check and emit MCP logging warning + stderr if the egov index is aged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: egov-only tools に warnings merge（resolve_law / search_law / get_law / get_article / diff_revision）

**Files:**
- Modify: `src/tools/resolve-law.ts`
- Modify: `src/tools/search-law.ts`
- Modify: `src/tools/get-law.ts`
- Modify: `src/tools/get-article.ts`
- Modify: `src/tools/diff-revision.ts`
- Create: `tests/tool-freshness-warnings.test.ts`（integration test の雛形）

- [ ] **Step 1: integration test を書く（failing 前提）**

`tests/tool-freshness-warnings.test.ts` を新規作成：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { indexMetadataRegistry } from '../src/lib/indexes/index-metadata.js';

const DAY = 24 * 60 * 60 * 1000;
const GENERATED_AT_MS = Date.parse('2026-04-02T00:00:00.000Z');

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const internal = server.server as unknown as {
    _requestHandlers: Map<string, (req: any) => Promise<any>>;
  };
  const handler = internal._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  const result = await handler({
    method: 'tools/call',
    params: { name, arguments: args },
  } as any);
  return result.structuredContent as { warnings: Array<{ code: string; message: string }> };
}

describe('tool freshness warnings integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    indexMetadataRegistry.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('egov 消費 tool', () => {
    it('resolve_law: egov aged で BUNDLED_INDEX_AGED を含む', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 61 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(true);
    });

    it('resolve_law: egov fresh なら BUNDLED_INDEX_AGED を含まない', async () => {
      vi.setSystemTime(new Date(GENERATED_AT_MS + 3 * DAY));
      const { createServer } = await import('../src/server.js');
      const server = createServer();
      const envelope = await callTool(server, 'resolve_law', { query: '労基法' });
      expect(envelope.warnings.some((w) => w.code === 'BUNDLED_INDEX_AGED')).toBe(false);
    });
  });
});
```

NOTE: 上記 `callTool` ユーティリティは MCP SDK の private field にアクセスしているため将来壊れる可能性がある。代替として、各 tool の handler をファクトリ関数から直接呼ぶよう register* 関数を変えるのが王道だが、現状コードは `server.registerTool` に inline で handler を渡しているため、まず internal 経由で動くことを確認し、脆さを `docs/superpowers/specs/` または別 Issue で記録するに留める。

- [ ] **Step 2: 失敗確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: test fail（warnings に BUNDLED_INDEX_AGED が含まれない）。

- [ ] **Step 3: 5 つの egov-only tool を修正**

各ファイルで、`createToolResult` に渡す envelope を構築している箇所に対し、envelope の `warnings` フィールドに `getIndexWarningsForTool(['egov'])` の結果を追加する。

`src/tools/resolve-law.ts` に以下の import を追加：

```ts
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
```

成功経路の envelope 構築を以下の形にする（既存の `warnings: []` や `warnings: existingWarnings` を差し替え）：

```ts
const freshnessWarnings = getIndexWarningsForTool(['egov']).map(({ code, message }) => ({ code, message }));
const envelope = {
  status: 'ok' as const,
  retryable: false,
  degraded: ...,
  warnings: [...freshnessWarnings],
  partial_failures: [],
  data: ...,
};
```

既に `warnings` に他の値を入れている tool の場合は spread で結合：

```ts
warnings: [...freshnessWarnings, ...existingWarnings],
```

同じパターンを以下にも適用：
- `src/tools/search-law.ts`
- `src/tools/get-law.ts`
- `src/tools/get-article.ts`
- `src/tools/diff-revision.ts`

各 tool の error 経路（`mapErrorToEnvelope` 経由）は既に `warnings: []` になっており、そちらは変更不要（失敗した tool response に warnings を足しても意味が薄い）。

- [ ] **Step 4: 該当 test が pass になることを確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: 2 tests passed。

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: build 成功、全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add src/tools/resolve-law.ts src/tools/search-law.ts src/tools/get-law.ts src/tools/get-article.ts src/tools/diff-revision.ts tests/tool-freshness-warnings.test.ts
git commit -m "$(cat <<'EOF'
Merge egov freshness warnings into law-tool responses

resolve_law, search_law, get_law, get_article, and diff_revision now
include BUNDLED_INDEX_AGED in their response warnings when the bundled
egov index is older than 60 days.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: runtime-only tools に warnings merge（search_mhlw / get_mhlw / search_jaish / get_jaish）

**Files:**
- Modify: `src/tools/search-mhlw-tsutatsu.ts`
- Modify: `src/tools/get-mhlw-tsutatsu.ts`
- Modify: `src/tools/search-jaish-tsutatsu.ts`
- Modify: `src/tools/get-jaish-tsutatsu.ts`
- Modify: `tests/tool-freshness-warnings.test.ts`（mhlw / jaish セクション追加）

- [ ] **Step 1: test を追記**

`tests/tool-freshness-warnings.test.ts` の `describe('tool freshness warnings integration', ...)` 内に以下の describe ブロックを追加：

```ts
describe('mhlw / jaish 消費 tool', () => {
  it('search_mhlw_tsutatsu: mhlw stale で RUNTIME_INDEX_STALE を含む', async () => {
    indexMetadataRegistry.register({
      source: 'mhlw',
      generated_at: '2026-04-02T00:00:00.000Z',
      last_success_at: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
      entry_count: 5,
    });
    vi.setSystemTime(new Date(GENERATED_AT_MS + 8 * DAY));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const envelope = await callTool(server, 'search_mhlw_tsutatsu', { keyword: '36協定' });
    expect(envelope.warnings.some((w) => w.code === 'RUNTIME_INDEX_STALE' && w.message.includes('厚生労働省通達'))).toBe(true);
  });

  it('search_jaish_tsutatsu: jaish stale で RUNTIME_INDEX_STALE を含む', async () => {
    indexMetadataRegistry.register({
      source: 'jaish',
      generated_at: '2026-04-02T00:00:00.000Z',
      last_success_at: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
      entry_count: 5,
    });
    vi.setSystemTime(new Date(GENERATED_AT_MS + 8 * DAY));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const envelope = await callTool(server, 'search_jaish_tsutatsu', { keyword: '労災' });
    expect(envelope.warnings.some((w) => w.code === 'RUNTIME_INDEX_STALE' && w.message.includes('JAISH'))).toBe(true);
  });
});
```

NOTE: search_mhlw_tsutatsu / search_jaish_tsutatsu は upstream を叩く可能性がある。テスト環境で upstream call が失敗しても warnings[] は envelope に含まれるため、test は warning の存在のみ assert し、status や data には依存しない。

- [ ] **Step 2: 失敗確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: 追加した 2 test が fail。

- [ ] **Step 3: 4 つの runtime-only tool を修正**

`src/tools/search-mhlw-tsutatsu.ts` で：

```ts
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
```

envelope 構築箇所（成功経路、upstream_fallback、stale_but_usable など全経路）で：

```ts
const freshnessWarnings = getIndexWarningsForTool(['mhlw']).map(({ code, message }) => ({ code, message }));
const envelope = {
  status: ...,
  warnings: [...freshnessWarnings, ...otherWarnings],
  // ...
};
```

同じパターンを：
- `src/tools/get-mhlw-tsutatsu.ts`（`['mhlw']`）
- `src/tools/search-jaish-tsutatsu.ts`（`['jaish']`）
- `src/tools/get-jaish-tsutatsu.ts`（`['jaish']`）

- [ ] **Step 4: test pass を確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: 追加した 2 test pass。

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add src/tools/search-mhlw-tsutatsu.ts src/tools/get-mhlw-tsutatsu.ts src/tools/search-jaish-tsutatsu.ts src/tools/get-jaish-tsutatsu.ts tests/tool-freshness-warnings.test.ts
git commit -m "$(cat <<'EOF'
Merge runtime freshness warnings into tsutatsu tool responses

search_mhlw_tsutatsu, get_mhlw_tsutatsu, search_jaish_tsutatsu, and
get_jaish_tsutatsu now include RUNTIME_INDEX_STALE in their response
warnings when the respective runtime index is older than 7 days.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: multi-source tools に warnings merge（find_related_sources / get_evidence_bundle）

**Files:**
- Modify: `src/tools/find-related-sources.ts`
- Modify: `src/tools/get-evidence-bundle.ts`
- Modify: `tests/tool-freshness-warnings.test.ts`

- [ ] **Step 1: test を追記**

`tests/tool-freshness-warnings.test.ts` に以下を追加：

```ts
describe('multi-source tool', () => {
  it('find_related_sources: egov aged + mhlw stale + jaish stale で 3 件の warning', async () => {
    indexMetadataRegistry.register({
      source: 'mhlw',
      generated_at: '2026-04-02T00:00:00.000Z',
      last_success_at: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
      entry_count: 5,
    });
    indexMetadataRegistry.register({
      source: 'jaish',
      generated_at: '2026-04-02T00:00:00.000Z',
      last_success_at: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
      entry_count: 5,
    });
    vi.setSystemTime(new Date(GENERATED_AT_MS + 61 * DAY));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const envelope = await callTool(server, 'find_related_sources', {
      law_id: '322AC0000000049',
      article_number: '36',
    });
    const codes = envelope.warnings.map((w) => w.code);
    expect(codes).toContain('BUNDLED_INDEX_AGED');
    expect(codes.filter((c) => c === 'RUNTIME_INDEX_STALE').length).toBe(2);
  });
});
```

NOTE: `find_related_sources` / `get_evidence_bundle` の正確な入力 schema は該当 tool のファイルを確認。上記は概念例。実装時に合わせて引数を調整すること。

- [ ] **Step 2: 失敗確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: 追加 test が fail。

- [ ] **Step 3: 2 つの multi-source tool を修正**

`src/tools/find-related-sources.ts` と `src/tools/get-evidence-bundle.ts` に：

```ts
import { getIndexWarningsForTool } from '../lib/indexes/freshness-warnings.js';
```

envelope 構築箇所で：

```ts
const freshnessWarnings = getIndexWarningsForTool(['egov', 'mhlw', 'jaish']).map(({ code, message }) => ({ code, message }));
const envelope = {
  // ...
  warnings: [...freshnessWarnings, ...existingWarnings],
  // ...
};
```

- [ ] **Step 4: test pass を確認**

```bash
npx vitest run tests/tool-freshness-warnings.test.ts
```

Expected: 追加 test pass。

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add src/tools/find-related-sources.ts src/tools/get-evidence-bundle.ts tests/tool-freshness-warnings.test.ts
git commit -m "$(cat <<'EOF'
Merge multi-source freshness warnings into aggregation tools

find_related_sources and get_evidence_bundle now compose freshness
warnings from all three index sources (egov, mhlw, jaish) into their
response warnings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: observability snapshot に bundled_age_days を露出

**Files:**
- Modify: `src/tools/get-observability-snapshot.ts`
- Create / Modify: `tests/observability-snapshot-bundled-age.test.ts`（または既存 `tests/observability.test.ts` に追記）

- [ ] **Step 1: test を書く**

`tests/observability.test.ts` に以下を追加（既存ファイルの describe 内に append）：

```ts
it('egov の snapshot に bundled_age_days が含まれる', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-12T00:00:00.000Z'));
  vi.resetModules();

  const { createServer } = await import('../src/server.js');
  const server = createServer();
  const internal = server.server as unknown as {
    _requestHandlers: Map<string, (req: any) => Promise<any>>;
  };
  const handler = internal._requestHandlers.get('tools/call')!;
  const result = await handler({
    method: 'tools/call',
    params: { name: 'get_observability_snapshot', arguments: {} },
  } as any);
  const envelope = result.structuredContent as any;
  const egov = envelope.data.indexes.find((i: any) => i.source === 'egov');
  expect(egov?.bundled_age_days).toBe(10);

  vi.useRealTimers();
});
```

- [ ] **Step 2: 失敗確認**

```bash
npx vitest run tests/observability.test.ts
```

Expected: 追加 test が fail（bundled_age_days が undefined）。

- [ ] **Step 3: schema に `bundled_age_days` を追加**

`src/tools/get-observability-snapshot.ts` の `indexes` schema に追記：

```ts
indexes: z.array(z.object({
  source: z.enum(['egov', 'mhlw', 'jaish']),
  generated_at: z.string(),
  last_success_at: z.string().optional(),
  last_failure_at: z.string().optional(),
  freshness: z.enum(['fresh', 'stale', 'unknown']),
  entry_count: z.number(),
  coverage_ratio: z.number().optional(),
  covered_years: z.array(z.number()).optional(),
  query_hit_rate: z.number().optional(),
  last_sync_scope: z.string().optional(),
  cold_start_minimum_scope: z.string().optional(),
  storage_path: z.string().optional(),
  snapshot_id: z.string().optional(),
  active_snapshot_id: z.string().optional(),
  last_promotion_at: z.string().optional(),
  last_known_good_at: z.string().optional(),
  rollback_count: z.number().optional(),
  bundled_age_days: z.number().optional(),
})),
```

- [ ] **Step 4: Markdown 整形 (`indexLines`) にも token 追加**

既存の行：

```ts
`- ${index.source}: freshness=${index.freshness}, entries=${index.entry_count}, coverage=${index.coverage_ratio ?? '-'}, ...`
```

の先頭付近（freshness 直後）に `bundled_age=` を追加：

```ts
`- ${index.source}: freshness=${index.freshness}, bundled_age_days=${index.bundled_age_days ?? '-'}, entries=${index.entry_count}, ...`
```

- [ ] **Step 5: Observability registry 側も bundled_age_days を伝播させる**

`src/lib/observability.ts` の index snapshot 構築箇所（`indexes` 配列を作っている部分）で、`getEgovIndexMeta()` 由来の meta をそのまま使っているはず。該当箇所を確認し、meta オブジェクトに既に `bundled_age_days` が埋め込まれていることを確認する（Task 1 で `withBundledAge` wrapper を通しているため自動的に含まれる想定）。埋め込まれていなければ registry → snapshot 変換時に追加する。

具体的には `src/lib/observability.ts` 内で `indexMetadataRegistry.list()` 呼出箇所周辺を grep し、snapshot 出力に `bundled_age_days` が漏れていないかを確認：

```bash
grep -n "bundled_age\|generated_at" src/lib/observability.ts
```

もし observability が registry の snapshot を直接返しているだけなら、egov については registry 登録時の値が使われる。そのため `persistEgovIndex` で `indexMetadataRegistry.register(withBundledAge(egovIndexMeta))` になっているかを確認し、なっていなければ Task 1 の修正に戻って register 時も wrap する。

- [ ] **Step 6: test pass を確認**

```bash
npx vitest run tests/observability.test.ts
```

Expected: all pass。

- [ ] **Step 7: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 8: Commit**

```bash
git add src/tools/get-observability-snapshot.ts src/lib/observability.ts tests/observability.test.ts
git commit -m "$(cat <<'EOF'
Expose bundled_age_days in observability snapshot

Adds the optional field to the index schema and Markdown rendering so
operators can see the current age of the bundled egov registry alongside
freshness state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: LLM Consumer Contract（server.ts instructions に追記）

**Files:**
- Modify: `src/server.ts`
- Create: `tests/server-instructions.test.ts`

- [ ] **Step 1: test を書く**

`tests/server-instructions.test.ts` を新規作成：

```ts
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

describe('server instructions', () => {
  it('freshness warnings のガイダンスが instructions に含まれる', () => {
    const server = createServer();
    const instructions = (server as unknown as { _instructions?: string })._instructions
      ?? (server.server as unknown as { _instructions?: string })._instructions;
    expect(instructions).toBeDefined();
    expect(instructions).toContain('freshness warnings');
    expect(instructions).toContain('BUNDLED_INDEX_AGED');
    expect(instructions).toContain('RUNTIME_INDEX_STALE');
  });
});
```

NOTE: `_instructions` への accessor は SDK のバージョンによって異なる可能性あり。実装時は `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` で内部保存箇所を確認し、必要なら test でオプションを `options.instructions` として直接検証する形に書き換える（`new McpServer(info, { instructions }).server.instructions` 等）。

- [ ] **Step 2: 失敗確認**

```bash
npx vitest run tests/server-instructions.test.ts
```

Expected: fail（instructions に含まれない）。

- [ ] **Step 3: `src/server.ts` の `instructions` を拡張**

既存の instructions 文字列末尾の `これらは本サーバーの取得対象外であり、本サーバー単体では原文取得を保証しません。` の**後ろ**に以下を追記：

```ts
instructions: `日本の労働・社会保険法令と行政通達の一次情報を取得するMCPサーバーです。

## サーバーの責務
- 本サーバーの責務は、法令・通達の原文取得、候補検索、出典URLの提示です
- 法的結論、要約、実務判断は上位クライアントの責務です

## 利用ルール
- 条文や通達に言及する場合は、必ず本サーバーのツールで取得した一次情報に基づくこと
- 取得した原文を引用する場合は、出典URLを明記すること
- 法令本文の取得は resolve_law で law_id を確定し、その後 get_article を使うこと
- ツール呼び出しが失敗した場合は、失敗を明示し、別ツールまたは別条件で再試行すること

## 取得対象外
- 判例・裁判例
- 告示・指針など、本サーバーが対応していない資料

これらは本サーバーの取得対象外であり、本サーバー単体では原文取得を保証しません。

## freshness warnings の扱い

tool response の warnings[] に以下の code が含まれる場合、回答本文に根拠を引用する前に、日本語で短く disclaim してください：

- BUNDLED_INDEX_AGED: 内蔵法令インデックスが古くなっています。最新改正が反映されていない可能性を利用者に伝えてください。
- RUNTIME_INDEX_STALE: 通達／判例インデックスが古くなっています。同じキーワードで再検索を試すよう利用者に案内してください。

warnings の message は既に利用者向け日本語になっています。paraphrase せず、そのまま引用することを推奨します。`,
```

- [ ] **Step 4: test pass を確認**

```bash
npx vitest run tests/server-instructions.test.ts
```

Expected: pass。

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/server-instructions.test.ts
git commit -m "$(cat <<'EOF'
Add freshness warnings guidance to server instructions

The server-level instructions field now directs LLM clients to surface
BUNDLED_INDEX_AGED and RUNTIME_INDEX_STALE warnings to end users as
disclaimers before citing evidence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: SPEC.md を実装実態に揃える（drift 解消）

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: §8 の陳腐化記述を削除**

`SPEC.md:300` 付近の「現時点の残件」リストから以下の行を削除：

```diff
-- freshness を返す内部索引モデルがない
```

（Phase 4 で内部索引モデルが導入済み、このリストは Phase 4 完了前の記述）。

- [ ] **Step 2: §13.3 を β 後の意味論に更新**

`SPEC.md:624` 付近を：

```markdown
### 13.3 freshness

- 各索引データには更新時刻を持たせる
- 検索結果には freshness を付与可能にする
```

から：

```markdown
### 13.3 freshness

- 各索引データには更新時刻 (`generated_at`) を持たせる
- 検索結果には freshness を付与する
- bundled source (`egov`) は freshness モデルから除外し、`freshness: 'unknown'` を固定で返す。代わりに `bundled_age_days` メトリクスを露出する
- runtime source (`mhlw`, `jaish`) のみ `fresh | stale | unknown` の 3 状態で判定する
- bundled age が閾値を超えた場合は `BUNDLED_INDEX_AGED` warning を、runtime が stale の場合は `RUNTIME_INDEX_STALE` warning を tool response に含める
```

- [ ] **Step 3: §14.2.6 の TTL 要件を現実化**

`SPEC.md:1199` 付近の「`fresh | stale | unknown` の判定基準と source 別 TTL を固定する」という作業項目を以下に置換：

```markdown
1. `fresh | stale | unknown` の判定基準を runtime source (`mhlw`, `jaish`) に限定する
2. 暫定として uniform 7日の TTL を運用する
3. source 別 TTL は将来の最適化項目とし、実測データ蓄積後に再検討する
```

- [ ] **Step 4: 新 §14.x セクションを追加**

`§14.2.7` の前（または末尾に近い論理的位置）に以下を追加：

```markdown
#### 14.2.8 ワークストリーム M: bundled index の age 警告

目的:
bundled source (`egov`) の age が一定を超えた場合に、利用者へ再起動または `npm update -g` を促す通知経路を設ける。

対象ファイル:

- 新規 `src/lib/indexes/freshness-warnings.ts`
- `src/index.ts`
- `src/server.ts`
- 各 tool の envelope 構築箇所

作業:

1. 閾値 60日（日本労働法の 4/1・10/1 施行サイクルに配慮）を `BUNDLED_AGE_THRESHOLD_DAYS` として定数化する
2. 起動時に MCP logging notification (`level: warning`) と stderr に一次通知する
3. egov を消費する全 tool の response `warnings[]` に `BUNDLED_INDEX_AGED` を毎回 merge する
4. server の `instructions` に LLM が warnings を surface するためのガイダンスを含める

受け入れ条件:

- bundled age 60日超で tool response および起動ログに日本語 warning が現れる
- egov 以外の source の freshness 判定は影響を受けない
- LLM が warnings を silent drop しないよう instructions で促される

テスト観点:

- bundled age 59/60/61日の境界挙動
- emit の両チャネル（MCP logging / stderr）それぞれの発火
- tool response への merge 網羅
- instructions に warning code が明記されていること

補足:

- カレンダー境界（直近 4/1・10/1 を跨いだら即警告）、opt-out env var、JST 日付表示、MCP status resource は別 Issue として追跡する
```

- [ ] **Step 5: 型チェックと全体回帰（SPEC は docs のみだが念のため）**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add SPEC.md
git commit -m "$(cat <<'EOF'
Align SPEC.md with freshness warnings implementation

Removes the outdated 'freshness を返す内部索引モデルがない' line,
clarifies that egov is excluded from the freshness model, scopes source-
specific TTL to runtime indexes as future work, and documents the new
bundled-age warning workstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: CHANGELOG と version bump

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: CHANGELOG.md に 0.3.0 エントリを追加**

先頭（`# Changelog` と `このプロジェクトの主な変更を記録します。` の後、`## [0.2.1] - 2026-04-03` の前）に追加：

```markdown
## [0.3.0] - YYYY-MM-DD

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
```

**Note**: `YYYY-MM-DD` はリリース直前に実日付に置換する（リリース担当者責務）。この PR 時点では placeholder として残す。

- [ ] **Step 2: `package.json` の version を 0.3.0 にする**

```diff
 {
   "name": "jp-labor-evidence-mcp",
-  "version": "0.2.1",
+  "version": "0.3.0",
```

- [ ] **Step 3: `src/server.ts` の version も揃える**

`src/server.ts:20` 付近：

```diff
 const server = new McpServer(
   {
     name: 'jp-labor-evidence-mcp',
-    version: '0.2.1',
+    version: '0.3.0',
   },
```

- [ ] **Step 4: `package-lock.json` も再生成**

```bash
npm install --package-lock-only
```

- [ ] **Step 5: 型チェックと全体回帰**

```bash
npm run build && npm test
```

Expected: 全 tests pass。

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md package.json package-lock.json src/server.ts
git commit -m "$(cat <<'EOF'
Bump version to 0.3.0 with freshness warnings changelog

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: 最終検証と仕上げ

**Files:** なし（verification only）

- [ ] **Step 1: 全テスト、build、pack dry-run を一括で回す**

```bash
npm run release:check
```

Expected: test / build / pack すべて成功。

- [ ] **Step 2: git log で作業履歴を俯瞰**

```bash
git log --oneline origin/main..HEAD
```

Expected: Task 1〜10 分の 10 commits が並ぶ。

- [ ] **Step 3: 差分サマリ確認**

```bash
git diff --stat origin/main..HEAD
```

Expected: 変更ファイル一覧が「ファイル構成」セクションで宣言したものと一致。

- [ ] **Step 4: `git push origin main` を実行するかどうかはユーザ判断**

push は shared state を変えるため、**プッシュ前にユーザに確認する**。auto mode でも shared systems の変更は explicit authorization 必要。

---

## Self-Review Checklist（engineer 実装後に最終確認）

- [ ] `docs/superpowers/specs/2026-04-25-freshness-warnings-design.md` の全セクションに対応するタスクが存在
- [ ] 「採択済み設計判断」表の全項目が実装・テストでカバー
- [ ] `BUNDLED_AGE_THRESHOLD_DAYS = 60` がコードとテストで一致
- [ ] 日本語 warning 文言がユーザ視点レビューの要求（再起動優先、`npm update -g` は補足）を満たす
- [ ] `freshness-warnings.ts` の全 public API が単体テストでカバー
- [ ] 11 tool すべてに source 依存が正しく宣言されている
- [ ] `emitStartupWarnings` の両チャネル（MCP logging + stderr）と失敗経路（sendLoggingMessage reject）がテストされている
- [ ] `server.instructions` に `BUNDLED_INDEX_AGED` と `RUNTIME_INDEX_STALE` が明記されている
- [ ] SPEC.md drift 3 箇所（§8/§13.3/§14.2.6）が整合
- [ ] CHANGELOG に 0.3.0 エントリが追加、`YYYY-MM-DD` は release 担当者責務として placeholder のまま
- [ ] `package.json` と `src/server.ts` の version が一致（0.3.0）

---

## 参考資料

- 設計仕様: `docs/superpowers/specs/2026-04-25-freshness-warnings-design.md`
- サブエージェントレビュー所見（この plan 作成時に反映済み）
- 関連 GitHub Issues: [#1](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues/1), [#2](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues/2), [#3](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues/3), [#4](https://github.com/finelagusaz/jp-labor-evidence-mcp/issues/4)
- 元々の時限爆弾: `src/lib/indexes/egov-index.ts:9` の `GENERATED_AT` literal
