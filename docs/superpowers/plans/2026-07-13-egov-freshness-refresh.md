# egov 鮮度リフレッシュ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** law-registry の41法令が本日時点で e-Gov と一致することを機械照合で裏付け、その証跡の上で bundled index の `GENERATED_AT` を 2026-07-13 へ更新する。

**Architecture:** 検証の純粋ロジック（正規化・分類・集計・bump ゲート・orchestrator）を型検査＋単体テスト対象の `src/lib/indexes/registry-verification.ts` に置き、`scripts/verify-egov-registry.ts` は既存 e-Gov アダプタへ注入して回すだけの薄い runner とする。照合が全件 OK に収束したら `GENERATED_AT` を bump し、日付連動テストを追従、CHANGELOG は `[Unreleased]` に相乗り（version 据え置き）。

**Tech Stack:** TypeScript 7（strict, NodeNext ESM）/ Node >=24 / vitest / tsx / 既存 `egovSourceAdapter`（e-Gov API v2）

## Global Constraints

- ESM（`"type": "module"`）+ NodeNext。**相対 import は必ず `.js` 拡張子**（例: `'../src/lib/law-registry.js'`）。TypeScript は strict。
- **version 据え置き**: `package.json`（0.5.0）/ `src/server.ts` の `SERVER_VERSION` / `package-lock.json` は**変更しない**。egov refresh は `CHANGELOG.md` `## [Unreleased]` に追記し、次の意図的な minor リリース（deps と同梱）で出荷。merge で `release.yml` を発火させない。
- **`verify:egov` はネットワーク依存**: CI / `release:check` / `prepublishOnly` に**混入させない**（maintainer 手動実行専用）。fresh プロセス実行前提で 1時間 raw cache を cold に保つ。
- **`GENERATED_AT` の意味**: 「41法令の lawId と正式名称を e-Gov で確認した日付」＝*メタデータの現在性*を保証する。条文改正・施行日の反映は保証しない（bundled index は条文本文を持たず索引メタのみ）。
- **bump 不可逆ゲート**: *同一実行*のレポートで全41件 `OK`、`NOT_FOUND`/`NAME_MISMATCH`/`ERROR` が 0件、検証日（UTC）が bump 日 `2026-07-13` と一致、レポートを PR 証跡に添付——を**すべて満たす場合のみ** `GENERATED_AT` を書き換える。
- **不可侵**: [tests/freshness-warnings.test.ts:357](../../../tests/freshness-warnings.test.ts#L357) の `最終同期: 2026-06-10 JST` と隣接する `.not.toContain('2026-06-09')`（:358）は **mhlw フィクスチャ（`2026-06-09T15:30:00Z`）由来で egov 非連動**。日付追従で**触ってはならない**（触ると壊れる）。

## File Structure

- Create: `src/lib/indexes/registry-verification.ts` — 検証の純粋ロジック＋orchestrator（依存なし・型検査＋単体テスト対象）
- Create: `scripts/verify-egov-registry.ts` — 薄いネットワーク runner（型検査は tsconfig.scripts.json 経由）
- Create: `tsconfig.scripts.json` — `scripts/` を `src/` と併せて型検査（noEmit）
- Create: `tests/registry-verification.test.ts` — 純粋ロジック＋orchestrator の単体テスト
- Modify: `package.json` — `verify:egov` / `typecheck:scripts` を追加
- Modify: `.gitignore` — レポート出力先を無視
- Modify: `src/lib/indexes/egov-index.ts:10` — `GENERATED_AT` を bump
- Modify: `tests/egov-index.test.ts` / `tests/status-resource.test.ts` / `tests/freshness-warnings.test.ts` / `tests/tool-freshness-warnings.test.ts` — 日付追従
- Modify（差分があった場合のみ）: `src/lib/law-registry.ts` / `README.md` / `docs/supported-laws.md`
- Modify: `CLAUDE.md` — 追従テスト記載の是正＋Commands 追記 / `CHANGELOG.md` — `[Unreleased]` 追記

---

### Task 1: 検証の純粋ロジック（正規化・分類・集計・ゲート）

**Files:**
- Create: `src/lib/indexes/registry-verification.ts`
- Test: `tests/registry-verification.test.ts`

**Interfaces:**
- Consumes: なし（依存なしの純粋モジュール）
- Produces:
  - `type LawVerificationStatus = 'OK' | 'NAME_MISMATCH' | 'NOT_FOUND' | 'ERROR'`
  - `type FetchOutcome = { ok: true; title: string } | { ok: false; errorMessage: string }`
  - `interface LawVerificationResult { lawId: string; expectedName: string; status: LawVerificationStatus; actualName?: string; error?: string }`
  - `interface VerificationReport { verifiedAt: string; total: number; counts: Record<LawVerificationStatus, number>; allOk: boolean; results: LawVerificationResult[] }`
  - `normalizeLawTitle(title: string): string`
  - `classifyFetchError(errorMessage: string): 'NOT_FOUND' | 'ERROR'`
  - `classifyResult(expectedName: string, outcome: FetchOutcome): LawVerificationStatus`
  - `summarizeReport(results: LawVerificationResult[], verifiedAt: string): VerificationReport`
  - `isBumpGateSatisfied(report: VerificationReport, bumpDateIsoDay: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/registry-verification.test.ts
import { describe, expect, it } from 'vitest';
import {
  normalizeLawTitle,
  classifyFetchError,
  classifyResult,
  summarizeReport,
  isBumpGateSatisfied,
  type LawVerificationResult,
} from '../src/lib/indexes/registry-verification.js';

describe('normalizeLawTitle', () => {
  it('NFKC 正規化と空白除去で表層差を吸収する', () => {
    // 全角スペース・半角スペース・前後空白は無視、幅は NFKC で統一
    expect(normalizeLawTitle(' 労働 基準法 ')).toBe(normalizeLawTitle('労働基準法'));
    expect(normalizeLawTitle('労働基準法')).toBe('労働基準法');
  });
});

describe('classifyFetchError', () => {
  it('404 は NOT_FOUND、それ以外は ERROR', () => {
    expect(classifyFetchError('HTTP 404 Not Found — https://laws.e-gov.go.jp/api/2/law_data/x')).toBe('NOT_FOUND');
    expect(classifyFetchError('HTTP 503 Service Unavailable — url')).toBe('ERROR');
    expect(classifyFetchError('Circuit breaker is open for https://... until 2026-...')).toBe('ERROR');
  });
});

describe('classifyResult', () => {
  it('名称一致で OK、ズレで NAME_MISMATCH', () => {
    expect(classifyResult('労働基準法', { ok: true, title: '労働基準法' })).toBe('OK');
    expect(classifyResult('労働基準法', { ok: true, title: '労働基準法施行令' })).toBe('NAME_MISMATCH');
  });
  it('取得失敗はエラー種別へ写像する', () => {
    expect(classifyResult('X', { ok: false, errorMessage: 'HTTP 404 ...' })).toBe('NOT_FOUND');
    expect(classifyResult('X', { ok: false, errorMessage: 'HTTP 500 ...' })).toBe('ERROR');
  });
});

describe('summarizeReport', () => {
  const ok = (lawId: string): LawVerificationResult => ({ lawId, expectedName: 'n', status: 'OK' });
  it('全件 OK なら allOk=true', () => {
    const report = summarizeReport([ok('a'), ok('b')], '2026-07-13T01:00:00.000Z');
    expect(report.counts.OK).toBe(2);
    expect(report.total).toBe(2);
    expect(report.allOk).toBe(true);
  });
  it('1件でも非 OK なら allOk=false', () => {
    const report = summarizeReport(
      [ok('a'), { lawId: 'b', expectedName: 'n', status: 'NOT_FOUND' }],
      '2026-07-13T01:00:00.000Z'
    );
    expect(report.counts.NOT_FOUND).toBe(1);
    expect(report.allOk).toBe(false);
  });
  it('空配列は allOk=false', () => {
    expect(summarizeReport([], '2026-07-13T01:00:00.000Z').allOk).toBe(false);
  });
});

describe('isBumpGateSatisfied', () => {
  const report = summarizeReport(
    [{ lawId: 'a', expectedName: 'n', status: 'OK' }],
    '2026-07-13T09:00:00.000Z'
  );
  it('全件 OK かつ検証日(UTC)が bump 日と一致で true', () => {
    expect(isBumpGateSatisfied(report, '2026-07-13')).toBe(true);
  });
  it('検証日がズレると false（古いレポート流用の防止）', () => {
    expect(isBumpGateSatisfied(report, '2026-07-14')).toBe(false);
  });
  it('非 OK を含むと false', () => {
    const bad = summarizeReport(
      [{ lawId: 'a', expectedName: 'n', status: 'ERROR' }],
      '2026-07-13T09:00:00.000Z'
    );
    expect(isBumpGateSatisfied(bad, '2026-07-13')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry-verification.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/indexes/registry-verification.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/indexes/registry-verification.ts

export type LawVerificationStatus = 'OK' | 'NAME_MISMATCH' | 'NOT_FOUND' | 'ERROR';

/** Fetch outcome for a single law: the fetched official title, or an error message. */
export type FetchOutcome =
  | { ok: true; title: string }
  | { ok: false; errorMessage: string };

export interface LawVerificationResult {
  lawId: string;
  expectedName: string;
  status: LawVerificationStatus;
  actualName?: string;
  error?: string;
}

export interface VerificationReport {
  /** ISO timestamp (UTC) at which verification ran. */
  verifiedAt: string;
  total: number;
  counts: Record<LawVerificationStatus, number>;
  allOk: boolean;
  results: LawVerificationResult[];
}

/**
 * Normalize a law title for comparison: NFKC (full/half-width unification) then
 * strip all whitespace. Japanese law titles carry no meaningful internal spaces,
 * so surface whitespace / width differences must not count as a name mismatch.
 */
export function normalizeLawTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, '');
}

/**
 * Classify an HTTP/adapter error message. The e-Gov adapter throws
 * `Error("HTTP {status} ...")` for non-2xx and `Error("Circuit breaker is open ...")`
 * when the breaker is tripped; only a 404 is a real NOT_FOUND, everything else
 * (5xx, timeout, circuit-open) is an unconfirmed ERROR.
 */
export function classifyFetchError(errorMessage: string): 'NOT_FOUND' | 'ERROR' {
  return /HTTP 404\b/.test(errorMessage) ? 'NOT_FOUND' : 'ERROR';
}

/** Classify a single law's verification outcome. */
export function classifyResult(expectedName: string, outcome: FetchOutcome): LawVerificationStatus {
  if (!outcome.ok) {
    return classifyFetchError(outcome.errorMessage);
  }
  return normalizeLawTitle(outcome.title) === normalizeLawTitle(expectedName) ? 'OK' : 'NAME_MISMATCH';
}

/** Aggregate per-law results. allOk iff there is ≥1 entry and every entry is OK. */
export function summarizeReport(
  results: LawVerificationResult[],
  verifiedAt: string
): VerificationReport {
  const counts: Record<LawVerificationStatus, number> = {
    OK: 0,
    NAME_MISMATCH: 0,
    NOT_FOUND: 0,
    ERROR: 0,
  };
  for (const r of results) counts[r.status] += 1;
  return {
    verifiedAt,
    total: results.length,
    counts,
    allOk: results.length > 0 && counts.OK === results.length,
    results,
  };
}

/**
 * The irreversible bump gate: the SAME-run report must be all-OK AND its
 * verification date (UTC day) must equal the intended bump date. Guards against
 * reusing a stale "all OK" report for a later-dated bump.
 */
export function isBumpGateSatisfied(report: VerificationReport, bumpDateIsoDay: string): boolean {
  if (!report.allOk) return false;
  return report.verifiedAt.slice(0, 10) === bumpDateIsoDay;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry-verification.test.ts`
Expected: PASS（全ケース緑）

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/registry-verification.ts tests/registry-verification.test.ts
git commit -m "feat(egov): add registry verification pure logic (classify/normalize/gate)"
```

---

### Task 2: verifyRegistry orchestrator（注入型・逐次）

**Files:**
- Modify: `src/lib/indexes/registry-verification.ts`（`verifyRegistry` を追加）
- Test: `tests/registry-verification.test.ts`（テスト追記）

**Interfaces:**
- Consumes: Task 1 の `classifyResult` / `summarizeReport` / 型
- Produces:
  - `verifyRegistry(entries: ReadonlyArray<readonly [string, string]>, fetchTitle: (lawId: string) => Promise<string>, verifiedAt: string): Promise<VerificationReport>`
  - 引数 `entries` は `[expectedName, lawId]` の配列（`Object.entries(LAW_ID_MAP)` と同形）。`fetchTitle` の reject は catch して分類に写す（1件失敗が全体を止めない）。逐次実行でアダプタのレート制御（maxConcurrency:1 / minIntervalMs:200）を尊重。

- [ ] **Step 1: Write the failing test**

```ts
// tests/registry-verification.test.ts に追記
import { verifyRegistry } from '../src/lib/indexes/registry-verification.js';

describe('verifyRegistry', () => {
  const entries: Array<[string, string]> = [
    ['労働基準法', '322AC0000000049'],
    ['雇用保険法', '349AC0000000116'],
  ];

  it('全件一致で allOk=true・OK 件数=総数', async () => {
    const titles: Record<string, string> = {
      '322AC0000000049': '労働基準法',
      '349AC0000000116': '雇用保険法',
    };
    const report = await verifyRegistry(entries, async (id) => titles[id], '2026-07-13T02:00:00.000Z');
    expect(report.allOk).toBe(true);
    expect(report.counts.OK).toBe(2);
    expect(report.verifiedAt).toBe('2026-07-13T02:00:00.000Z');
  });

  it('404 reject は NOT_FOUND・他は継続する', async () => {
    const report = await verifyRegistry(
      entries,
      async (id) => {
        if (id === '349AC0000000116') throw new Error('HTTP 404 Not Found — url');
        return '労働基準法';
      },
      '2026-07-13T02:00:00.000Z'
    );
    expect(report.counts.OK).toBe(1);
    expect(report.counts.NOT_FOUND).toBe(1);
    expect(report.allOk).toBe(false);
    expect(report.results).toHaveLength(2); // 1件失敗しても全件分の結果が残る
    expect(report.results.find((r) => r.lawId === '349AC0000000116')?.status).toBe('NOT_FOUND');
  });

  it('名称ズレは NAME_MISMATCH（actualName を残す）', async () => {
    const report = await verifyRegistry(
      [['労働基準法', '322AC0000000049']],
      async () => '労働基準法施行令',
      '2026-07-13T02:00:00.000Z'
    );
    expect(report.results[0]?.status).toBe('NAME_MISMATCH');
    expect(report.results[0]?.actualName).toBe('労働基準法施行令');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry-verification.test.ts -t verifyRegistry`
Expected: FAIL — `verifyRegistry is not a function`（未 export）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/indexes/registry-verification.ts の末尾に追記
/**
 * Verify (name → lawId) registry entries against a title fetcher, sequentially
 * (so the caller's rate limiting / single concurrency is respected). A rejected
 * fetch is captured as NOT_FOUND/ERROR — one failing law never aborts the run.
 */
export async function verifyRegistry(
  entries: ReadonlyArray<readonly [string, string]>,
  fetchTitle: (lawId: string) => Promise<string>,
  verifiedAt: string
): Promise<VerificationReport> {
  const results: LawVerificationResult[] = [];
  for (const [expectedName, lawId] of entries) {
    let outcome: FetchOutcome;
    try {
      outcome = { ok: true, title: await fetchTitle(lawId) };
    } catch (error) {
      outcome = { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
    }
    results.push({
      lawId,
      expectedName,
      status: classifyResult(expectedName, outcome),
      actualName: outcome.ok ? outcome.title : undefined,
      error: outcome.ok ? undefined : outcome.errorMessage,
    });
  }
  return summarizeReport(results, verifiedAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry-verification.test.ts`
Expected: PASS（Task 1 分も含め全ケース緑）

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/registry-verification.ts tests/registry-verification.test.ts
git commit -m "feat(egov): add verifyRegistry orchestrator (injectable fetch, sequential)"
```

---

### Task 3: 薄い runner ＋ npm script ＋ 型検査経路 ＋ gitignore

**Files:**
- Create: `scripts/verify-egov-registry.ts`
- Create: `tsconfig.scripts.json`
- Modify: `package.json`（`scripts` に 2 行追加）
- Modify: `.gitignore`（1 行追加）

**Interfaces:**
- Consumes: `verifyRegistry`（Task 2）、`LAW_ID_MAP`（`src/lib/law-registry.js`）、`egovSourceAdapter`（`src/lib/source-adapters/egov-source-adapter.js`）、`extractLawTitle`（`src/lib/egov-parser.js`）
- Produces: `npm run verify:egov`（実行）、`npm run typecheck:scripts`（型検査）、レポート `egov-verify-report.json`（gitignored、`EGOV_VERIFY_OUT` で上書き可）

- [ ] **Step 1: 薄い runner を作成**

```ts
// scripts/verify-egov-registry.ts
// Maintainer-only. NETWORK-DEPENDENT — hits the live e-Gov API v2.
// NOT for CI / release:check / prepublishOnly (design spec §1). Run in a fresh
// process so the 1h in-memory raw cache (lawDataRawCache) starts cold.
import { writeFileSync } from 'node:fs';
import { LAW_ID_MAP } from '../src/lib/law-registry.js';
import { egovSourceAdapter } from '../src/lib/source-adapters/egov-source-adapter.js';
import { extractLawTitle } from '../src/lib/egov-parser.js';
import { verifyRegistry } from '../src/lib/indexes/registry-verification.js';

const REPORT_PATH = process.env.EGOV_VERIFY_OUT ?? 'egov-verify-report.json';

async function main(): Promise<void> {
  const entries = Object.entries(LAW_ID_MAP);
  const report = await verifyRegistry(
    entries,
    async (lawId) => extractLawTitle(await egovSourceAdapter.fetchLawDataById(lawId)),
    new Date().toISOString()
  );

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`e-Gov registry verification — ${report.verifiedAt}`);
  console.log(
    `  total=${report.total} OK=${report.counts.OK} ` +
      `NAME_MISMATCH=${report.counts.NAME_MISMATCH} ` +
      `NOT_FOUND=${report.counts.NOT_FOUND} ERROR=${report.counts.ERROR}`
  );
  for (const r of report.results) {
    if (r.status !== 'OK') {
      console.log(
        `  [${r.status}] ${r.lawId} expected="${r.expectedName}" ` +
          `actual="${r.actualName ?? ''}" ${r.error ?? ''}`
      );
    }
  }
  console.log(`report written to ${REPORT_PATH}`);

  if (!report.allOk) {
    console.error(
      `NOT ALL OK — ${report.total - report.counts.OK} 件が要確認。GENERATED_AT bump は保留。`
    );
    process.exit(1);
  }
  console.log('全件 OK。GENERATED_AT bump ゲート充足（検証日を bump 日と一致させること）。');
}

main().catch((error) => {
  console.error('verify-egov-registry failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: 型検査用 tsconfig を作成**

`src/` の `tsconfig.json` は `rootDir: ./src` かつ `include: ["src/**/*"]` で `scripts/` を型検査しない。別 config で `scripts/` を `src/` と併せて noEmit 型検査する。

```json
// tsconfig.scripts.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["scripts/**/*", "src/**/*"]
}
```

- [ ] **Step 3: package.json に script を追加**

`scripts` ブロックの `"sync:indexes:incremental"` 行の直後に追加:

```json
    "verify:egov": "tsx scripts/verify-egov-registry.ts",
    "typecheck:scripts": "tsc -p tsconfig.scripts.json",
```

（`release:check` / `prepublishOnly` は変更しない。`verify:egov` を publish gate に混ぜないこと。）

- [ ] **Step 4: .gitignore にレポート出力先を追加**

`.gitignore` の末尾に追加:

```
egov-verify-report.json
```

- [ ] **Step 5: 型検査が通ることを確認**

Run: `npm run typecheck:scripts`
Expected: エラー無しで終了（exit 0）。`scripts/verify-egov-registry.ts` の型不整合があればここで検知。

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-egov-registry.ts tsconfig.scripts.json package.json .gitignore
git commit -m "feat(egov): add verify:egov runner + typecheck:scripts + gitignore report"
```

---

### Task 4: 【運用】live 照合と差分反映（ネットワーク・人手判断）

> **注意:** このタスクは**ネットワークと人手判断を含む運用手順**であり、自動 TDD ではない。実行者（subagent の場合も）は照合結果を機械的に判定し、差分があれば**人へ判断を仰ぐ**こと。全件 OK に収束しない限り Task 5 へ進まない。

**Files:**
- Modify（差分があった場合のみ）: `src/lib/law-registry.ts`、`README.md`、`docs/supported-laws.md`

**Interfaces:**
- Consumes: `npm run verify:egov`（Task 3）
- Produces: 全件 OK の照合レポート `egov-verify-report.json`（PR 証跡）

- [ ] **Step 1: fresh プロセスで照合を実行**

Run: `npm run verify:egov`
Expected: 41件を順次照合（レート制御で約 8〜10 秒以上）。標準出力に集計、`egov-verify-report.json` を出力。全件 OK なら exit 0、差分ありなら exit 1。

- [ ] **Step 2: 結果を判定**

- **全件 OK（exit 0）** → Step 4 へ（レポートを証跡として保持し Task 5 へ）
- **差分あり（exit 1）** → Step 3 へ

- [ ] **Step 3: 差分を反映（差分があった場合のみ）**

レポートの非 OK エントリごとに人が判断:
- `NAME_MISMATCH` → e-Gov の正式名称が変わった疑い。`src/lib/law-registry.ts` の `LAW_ID_MAP` のキー（および必要なら `LAW_ALIAS_MAP`）を実名称へ修正
- `NOT_FOUND` → 廃止 / law_id 変更の疑い。代替 law_id への差し替え、または当該法令の削除を人が判断
- `ERROR` → 一時障害 / circuit-open。**照合済みに数えない**。時間を置いて Step 1 から再実行

**文書追従（law_id 数や名称が変わった場合のみ）:**
- `README.md` の「41 法令」表記（[:189](../../../README.md#L189) / [:199](../../../README.md#L199)）を新件数へ
- `docs/supported-laws.md` の件数（[:3](../../../docs/supported-laws.md#L3)）と該当テーブル行を追従

修正後、**Step 1 から再実行**して同一実行で全件 OK に収束させる。

- [ ] **Step 4: レポートを PR 証跡として保全**

`egov-verify-report.json`（gitignored）を PR に添付、または要約（`verifiedAt` と全件 OK の集計）を PR 本文へ転記。`verifiedAt` の UTC 日が `2026-07-13` であることを確認（ズレていれば bump 日と揃うよう再実行）。

- [ ] **Step 5: Commit（差分反映があった場合のみ）**

```bash
# 差分反映で law-registry / README / docs を触った場合のみ
git add src/lib/law-registry.ts README.md docs/supported-laws.md
git commit -m "fix(egov): reconcile law-registry with live e-Gov (verify:egov)"
```

---

### Task 5: GENERATED_AT bump と日付追従テスト（逆順 TDD）

> 前提: Task 4 が「同一実行で全件 OK・検証日 = 2026-07-13」に収束済み。

**Files:**
- Modify: `src/lib/indexes/egov-index.ts:10`
- Modify: `tests/egov-index.test.ts:7`、`tests/status-resource.test.ts:4`、`tests/freshness-warnings.test.ts:8` と `:365`、`tests/tool-freshness-warnings.test.ts:6`

**Interfaces:**
- Consumes: なし（データ・テストの日付更新）
- Produces: `GENERATED_AT = '2026-07-13T00:00:00.000Z'` に整合した test スイート

- [ ] **Step 1: GENERATED_AT のみを bump（先に赤を出す）**

[src/lib/indexes/egov-index.ts:10](../../../src/lib/indexes/egov-index.ts#L10):

```ts
const GENERATED_AT = '2026-07-13T00:00:00.000Z';
```

- [ ] **Step 2: テストを走らせ、赤化するファイルを観察**

Run: `npm test`
Expected: FAIL。赤化するのは**追従が必要な4ファイルのみ**:
- `tests/egov-index.test.ts`（`bundled_age_days` が負値 → `toBe(0)` 失敗）
- `tests/status-resource.test.ts`（`generated_at` / `bundled_age_days` 不一致）
- `tests/freshness-warnings.test.ts`（`生成日: 2026-06-10 JST` 不一致、aged/fresh 判定ズレ）
- `tests/tool-freshness-warnings.test.ts`（+61日/+3日 オフセットの発火判定ズレ）

**緑のままであるべき（＝追従不要の実証）:** `tests/indexes-time.test.ts`、`tests/observability.test.ts`、`tests/find-related-sources-tool.test.ts`、`tests/tool-wire-contract.test.ts`。これらが赤化したら想定外——原因を確認する。

- [ ] **Step 3: 4ファイルの日付を追従**

`tests/egov-index.test.ts:7`:
```ts
    vi.setSystemTime(new Date('2026-07-13T12:00:00.000Z'));
```

`tests/status-resource.test.ts:4`:
```ts
const GENERATED_AT_ISO = '2026-07-13T00:00:00.000Z';
```

`tests/freshness-warnings.test.ts:8`:
```ts
const GENERATED_AT_ISO = '2026-07-13T00:00:00.000Z';
```

`tests/freshness-warnings.test.ts:365`:
```ts
      expect(message).toContain('生成日: 2026-07-13 JST');
```

`tests/tool-freshness-warnings.test.ts:6`:
```ts
const GENERATED_AT_MS = Date.parse('2026-07-13T00:00:00.000Z');
```

> ⚠️ **`tests/freshness-warnings.test.ts:357`（`最終同期: 2026-06-10 JST`）と `:358`（`.not.toContain('2026-06-09')`）は触らない。** mhlw フィクスチャ（`2026-06-09T15:30:00Z`）由来で egov 非連動。書き換えると赤化する。

- [ ] **Step 4: テストが全緑に戻ることを確認**

Run: `npm test`
Expected: PASS（全ファイル緑）

- [ ] **Step 5: sync:indexes が新 generated_at を反映することを確認**

Run: `npm run sync:indexes`
Expected: 正常終了。エラー時は `rm -rf .jp-labor-evidence-indexes` で復旧して再実行（CLAUDE.md Gotchas）。

- [ ] **Step 6: build が通ることを確認**

Run: `npm run build`
Expected: エラー無し（exit 0）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/indexes/egov-index.ts tests/egov-index.test.ts tests/status-resource.test.ts tests/freshness-warnings.test.ts tests/tool-freshness-warnings.test.ts
git commit -m "chore(egov): bump GENERATED_AT to 2026-07-13 (verified) + follow date-tied tests"
```

---

### Task 6: CLAUDE.md 是正 ＋ CHANGELOG [Unreleased] 追記

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: なし
- Produces: 追従テスト記載の是正、`verify:egov` の Commands 記載、CHANGELOG `[Unreleased]` 追記

- [ ] **Step 1: CLAUDE.md の追従テスト記載に status-resource を追加**

「bump 時は freshness 結合テストも同じ日付へ追従必須」の列挙（`tests/egov-index.test.ts` の `setSystemTime`）の直後に `tests/status-resource.test.ts` を追加する。**`indexes-time.test.ts` は追加しない**（追従不要）。該当箇所の末尾を次のように:

```
…[tests/egov-index.test.ts](tests/egov-index.test.ts) の `setSystemTime`、[tests/status-resource.test.ts](tests/status-resource.test.ts) の `GENERATED_AT_ISO`。怠ると `BUNDLED_INDEX_AGED` の発火位置がズレて test が赤化する
```

- [ ] **Step 2: CLAUDE.md の Commands に verify:egov を追加**

`## Commands` の `npm run sync:indexes[...]` 行の直後に追加:

```
- `npm run verify:egov` — `LAW_ID_MAP` を live e-Gov と照合（**ネットワーク依存・CI/publish gate 対象外・maintainer 用**）。全件 OK なら exit 0。`GENERATED_AT` bump 前の裏付けに使う
```

- [ ] **Step 3: CHANGELOG の [Unreleased] に追記**

`CHANGELOG.md` の `## [Unreleased]` 内、`### Changed` の末尾に 1 行追加:

```
- （データ）bundled law index の `GENERATED_AT` を `2026-07-13` に更新。`verify:egov` で全41法令の現存性・正式名称を live e-Gov と照合した裏付けの上で再スタンプ（メタデータの現在性を保証。条文改正の反映は非保証）。freshness 系テストの時刻基準を追従
```

`### Changed` と `### Security` の間に新セクションを挿入:

```
### Added

- `verify:egov`（`scripts/verify-egov-registry.ts`）: `LAW_ID_MAP` を live e-Gov API v2 と照合し `OK/NAME_MISMATCH/NOT_FOUND/ERROR` に分類する maintainer 用スクリプト（ネットワーク依存・CI 対象外）。検証ロジックは `src/lib/indexes/registry-verification.ts` に分離し単体テスト対象
```

（version は据え置き。`## [x.y.z] - 実日付` への昇格は次リリース PR の責務。）

- [ ] **Step 4: 最終確認**

Run: `npm test && npm run build && npm run typecheck:scripts`
Expected: すべて緑（exit 0）。

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs(egov): correct GENERATED_AT follow-test list + CHANGELOG [Unreleased]"
```

---

## Self-Review

**1. Spec coverage（改訂 spec の各節 → タスク対応）:**
- §1 照合スクリプト（比較規約 / 404 分類 / circuit-open / キャッシュ回避 / レポート出力 / tsconfig 型検査 / release gate 除外）→ Task 1・2・3
- §2 law-registry 反映 ＋ README/docs 条件付き追従 → Task 4
- §3 bump 不可逆ゲート ＋ テスト追従（正確版・罠回避）→ Task 1（`isBumpGateSatisfied`）・Task 4（ゲート運用）・Task 5（追従）
- §4 CLAUDE.md 是正（status-resource 追加 / indexes-time 除外 / Commands）→ Task 6
- §5 リリース（据え置き・[Unreleased] 相乗り・version 不変）→ Global Constraints ＋ Task 6
- 目的の「GENERATED_AT の意味と限界」→ Global Constraints ＋ Task 6 の CHANGELOG 文言に反映
- カレンダー境界（bump 後 10/1 発火）→ Task 5 Step 2 の「緑のままであるべき」で境界テスト非赤化を確認

**2. Placeholder scan:** 各コード step は完全なコードを含む。「適切なエラー処理」等の曖昧語なし。Task 4 は運用手順ゆえコードではなく判断基準を明示。

**3. Type consistency:** `LawVerificationStatus` / `FetchOutcome` / `VerificationReport` / `verifyRegistry` / `isBumpGateSatisfied` の名称・シグネチャは Task 1・2 の定義と Task 3 の呼び出しで一致。runner は `verifyRegistry(entries, fetchTitle, verifiedAt)` を Task 2 の定義どおり呼ぶ。
