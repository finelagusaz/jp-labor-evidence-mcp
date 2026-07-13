# e-Gov 未施行改正の検知（get_article opt-in）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_article` に opt-in 入力 `include_pending_amendments`（既定 false）を追加し、true のとき e-Gov `/law_revisions` を追引きして未施行改正（`UnEnforced` 版）を検知、`pending_amendments[]`（施行日昇順）＋概要警告（誤帰属 hedge 付き）を返す。取得失敗は graceful degrade（条文は必ず返す）。

**Architecture:** v1（現行版表示）と同じ層構成を踏襲。新エンドポイントは adapter (`fetchLawRevisions`) → egov-client → law-service (`getPendingAmendments`)。変換は `evidence-metadata.ts` の純粋関数（`buildPendingAmendments` / `getPendingAmendmentWarnings`）。v1 の `version_pinned_url` 生成を `buildVersionPinnedUrl` へ共通化。

**Tech Stack:** TypeScript (ESM, NodeNext)、zod、vitest、`@modelcontextprotocol/sdk`。

## Global Constraints

すべての Task はこれらを暗黙に含む（spec `docs/superpowers/specs/2026-07-13-egov-pending-amendments-design.md` より）:

- **opt-in**: `/law_revisions` を引くのは `args.include_pending_amendments === true` のときだけ。既定/省略/false では引かない。
- **防御的パース**: 全フィールドに `cleanValue`（null/空→undefined）。`enforcement_date`（= `amendment_enforcement_date`）が取れない `UnEnforced` 版は**除外し `excludedCount` で数える**（required 保証はないため）。
- **純粋 helper**: 引数を mutate しない（`filter`/`map`/新規配列に対して `sort`）。
- **ソート**: 第1キー `enforcement_date` 昇順、第2キー `law_revision_id` 昇順（同日 tie を決定的化）。
- **誤帰属 hedge**: 警告に anchor「現行施行版に対し」＋「※これは法令全体の改正予定であり、引用した条文が改正対象に含まれるとは限りません」。**改正法名は警告文に列挙しない**（構造化のみ）。
- **改正/廃止の区別**: `repeal_status != 'None'` の件は「廃止予定 M 件」として改正 N 件と分けて数える。
- **degrade**: 条文取得（v1 経路）成功を**絶対に失わない**——pending 取得は独立 inner try/catch。`status = partial_failures.length > 0 ? 'partial' : 'ok'`、`degraded=true`、`observabilityRegistry.recordPartialFailure('egov', 1)`、警告 `PENDING_AMENDMENT_CHECK_FAILED`。
- **text 節は追加しない**（構造化＋警告の2層。SPEC.md §9.5）。
- 追加ネットワークは `/law_revisions` の**1リクエストのみ**（ページングなし）。

**Commit trailer（全 commit 共通）**: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Create:**
- `tests/fixtures/egov/law-revisions-anei.json` — 複数 UnEnforced（同日 tie・null field・enforcement_date 欠落・CurrentEnforced/PreviousEnforced 混在）（Task 5）。
- `tests/fixtures/egov/law-revisions-none.json` — 未施行なし（全 CurrentEnforced/PreviousEnforced）（Task 5）。
- `tests/pending-amendments.test.ts` — helper 単体＋law-service（Task 1-3, 5）。
- `tests/get-article-pending.test.ts` — get_article の callTool 統合（Task 6）。

**Modify:**
- `src/lib/types.ts` — `PendingAmendment` / `EgovLawRevisionsResponse` 型を追加（Task 1）。
- `src/lib/evidence-metadata.ts` — `buildVersionPinnedUrl`（＋`buildRevisionMetadata` refactor）（Task 1）、`buildPendingAmendments`（Task 2）、`getPendingAmendmentWarnings`（Task 3）。
- `src/lib/cache.ts` — `lawRevisionsRawCache`（Task 4）。
- `src/lib/source-adapters/egov-source-adapter.ts` — `fetchLawRevisions`（Task 4）。
- `src/lib/egov-client.ts` — `fetchLawRevisions` 薄いラッパ（Task 4）。
- `src/lib/services/law-service.ts` — `getPendingAmendments`（Task 5）。
- `src/lib/tool-contract.ts` — `pendingAmendmentSchema`（Task 6）。
- `src/tools/get-article.ts` — input param・description nudge・output schema・handler degrade（Task 6）。

---

## Task 1: 型 ＋ `buildVersionPinnedUrl`（v1 refactor）

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/pending-amendments.test.ts`（新規）

**Interfaces:**
- Produces: `PendingAmendment`（`enforcement_date: string` 必須・他 optional）、`EgovLawRevisionsResponse`、`buildVersionPinnedUrl(lawRevisionId?: string): string | undefined`

- [ ] **Step 1: 型を追加**

`src/lib/types.ts` の `EgovNode` 定義の直前（`EgovLawData` の後）に追加:

```ts
/** e-Gov /law_revisions（法令履歴一覧）レスポンス */
export interface EgovLawRevisionsResponse {
  law_info?: EgovLawData['law_info'];
  revisions?: EgovRevisionInfo[];
}

/** get_article の pending_amendments 各件（施行日昇順） */
export interface PendingAmendment {
  enforcement_date: string;       // = amendment_enforcement_date（除外により出力では常在）
  amendment_law_num?: string;
  amendment_law_title?: string;
  law_revision_id?: string;
  version_pinned_url?: string;
  enforcement_note?: string;      // = amendment_enforcement_comment
  repeal_status?: string;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/pending-amendments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildVersionPinnedUrl } from '../src/lib/evidence-metadata.js';

describe('buildVersionPinnedUrl', () => {
  it('law_revision_id から /api/2/law_data/{id} を導出', () => {
    expect(buildVersionPinnedUrl('322AC0000000049_20281223_508AC0000000046'))
      .toBe('https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049_20281223_508AC0000000046');
  });
  it('null/空/undefined は undefined', () => {
    expect(buildVersionPinnedUrl(undefined)).toBeUndefined();
    expect(buildVersionPinnedUrl('')).toBeUndefined();
    expect(buildVersionPinnedUrl('   ')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- pending-amendments`
Expected: FAIL（`buildVersionPinnedUrl` is not exported）

- [ ] **Step 4: 実装＋v1 refactor**

`src/lib/evidence-metadata.ts`:

(a) `const EGOV_LAW_DATA_API = ...` の直後（`cleanValue` の後）に追加:

```ts
/** law_revision_id から版固定 URL（/api/2/law_data/{id}）を導出。純粋。 */
export function buildVersionPinnedUrl(lawRevisionId: string | undefined): string | undefined {
  const id = cleanValue(lawRevisionId);
  return id ? `${EGOV_LAW_DATA_API}/${id}` : undefined;
}
```

(b) `buildRevisionMetadata` 内の `version_pinned_url` 行（現状 `lawRevisionId ? \`${EGOV_LAW_DATA_API}/${lawRevisionId}\` : undefined`）を置換して共通ヘルパを使う:

```ts
    version_pinned_url: buildVersionPinnedUrl(revisionInfo.law_revision_id),
```

- [ ] **Step 5: 成功＋v1 回帰を確認**

Run: `npm test -- pending-amendments revision-metadata`
Expected: PASS（新規2件＋既存 revision-metadata suite が refactor 後も green）

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/evidence-metadata.ts tests/pending-amendments.test.ts
git commit -m "feat(egov): add PendingAmendment/EgovLawRevisionsResponse types + buildVersionPinnedUrl (v1 refactor)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildPendingAmendments`

**Files:**
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/pending-amendments.test.ts`（追記）

**Interfaces:**
- Consumes: `EgovRevisionInfo`、`PendingAmendment`（Task 1）、`buildVersionPinnedUrl`、`cleanValue`
- Produces: `buildPendingAmendments(revisions?: EgovRevisionInfo[]): { amendments: PendingAmendment[]; excludedCount: number }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pending-amendments.test.ts` に追記（import に `buildPendingAmendments` を追加）:

```ts
import { buildVersionPinnedUrl, buildPendingAmendments } from '../src/lib/evidence-metadata.js';
import type { EgovRevisionInfo } from '../src/lib/types.js';

const rev = (o: Partial<EgovRevisionInfo>): EgovRevisionInfo => ({ ...o });

describe('buildPendingAmendments', () => {
  it('UnEnforced を抽出し (施行日, law_revision_id) 昇順・非UnEnforced除外', () => {
    const built = buildPendingAmendments([
      rev({ law_revision_id: 'L_20300401_a', amendment_enforcement_date: '2030-04-01', current_revision_status: 'UnEnforced' }),
      rev({ law_revision_id: 'L_20270401_508', amendment_enforcement_date: '2027-04-01', current_revision_status: 'UnEnforced' }),
      rev({ law_revision_id: 'L_20270401_507', amendment_enforcement_date: '2027-04-01', current_revision_status: 'UnEnforced' }),
      rev({ law_revision_id: 'L_cur', amendment_enforcement_date: '2026-01-01', current_revision_status: 'CurrentEnforced' }),
      rev({ law_revision_id: 'L_prev', amendment_enforcement_date: '2020-01-01', current_revision_status: 'PreviousEnforced' }),
    ]);
    expect(built.excludedCount).toBe(0);
    expect(built.amendments.map((a) => a.enforcement_date)).toEqual(['2027-04-01', '2027-04-01', '2030-04-01']);
    // 同日 tie は law_revision_id 昇順（_507 < _508）
    expect(built.amendments[0].law_revision_id).toBe('L_20270401_507');
    expect(built.amendments[1].law_revision_id).toBe('L_20270401_508');
    expect(built.amendments[0].version_pinned_url).toContain('/api/2/law_data/L_20270401_507');
  });

  it('enforcement_date 欠落の UnEnforced 版は除外し excludedCount で数える', () => {
    const built = buildPendingAmendments([
      rev({ law_revision_id: 'L_ok', amendment_enforcement_date: '2027-04-01', current_revision_status: 'UnEnforced' }),
      rev({ law_revision_id: 'L_nodate', amendment_enforcement_date: null, current_revision_status: 'UnEnforced' }),
    ]);
    expect(built.amendments).toHaveLength(1);
    expect(built.excludedCount).toBe(1);
  });

  it('null フィールド・repeal_status passthrough・入力を mutate しない', () => {
    const input = [rev({
      law_revision_id: 'L_1', amendment_enforcement_date: '2027-04-01', current_revision_status: 'UnEnforced',
      amendment_law_num: null, repeal_status: 'Repeal',
    })];
    const snapshot = JSON.stringify(input);
    const built = buildPendingAmendments(input);
    expect(built.amendments[0].amendment_law_num).toBeUndefined();
    expect(built.amendments[0].repeal_status).toBe('Repeal');
    expect(JSON.stringify(input)).toBe(snapshot); // 入力不変
  });

  it('undefined / UnEnforced なし → 空', () => {
    expect(buildPendingAmendments(undefined)).toEqual({ amendments: [], excludedCount: 0 });
    expect(buildPendingAmendments([rev({ current_revision_status: 'CurrentEnforced' })])).toEqual({ amendments: [], excludedCount: 0 });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- pending-amendments`
Expected: FAIL（`buildPendingAmendments` is not a function）

- [ ] **Step 3: 実装を追加**

`src/lib/evidence-metadata.ts` の末尾に追加（import に `PendingAmendment` を追加: `import type { EgovRevisionInfo, PendingAmendment, RevisionMetadata, WarningMessage } from './types.js';`）:

```ts
/**
 * /law_revisions の revisions から未施行改正（UnEnforced）を抽出し、
 * (enforcement_date, law_revision_id) 昇順の PendingAmendment[] を返す。
 * enforcement_date を持たない版は除外し excludedCount で数える。純粋（入力を mutate しない）。
 */
export function buildPendingAmendments(
  revisions: EgovRevisionInfo[] | undefined,
): { amendments: PendingAmendment[]; excludedCount: number } {
  if (!revisions) return { amendments: [], excludedCount: 0 };
  let excludedCount = 0;
  const amendments: PendingAmendment[] = [];
  for (const rev of revisions) {
    if (cleanValue(rev.current_revision_status) !== 'UnEnforced') continue;
    const enforcementDate = cleanValue(rev.amendment_enforcement_date);
    if (!enforcementDate) {
      excludedCount += 1;
      continue;
    }
    amendments.push({
      enforcement_date: enforcementDate,
      amendment_law_num: cleanValue(rev.amendment_law_num),
      amendment_law_title: cleanValue(rev.amendment_law_title),
      law_revision_id: cleanValue(rev.law_revision_id),
      version_pinned_url: buildVersionPinnedUrl(rev.law_revision_id),
      enforcement_note: cleanValue(rev.amendment_enforcement_comment),
      repeal_status: cleanValue(rev.repeal_status),
    });
  }
  amendments.sort((a, b) => {
    if (a.enforcement_date !== b.enforcement_date) {
      return a.enforcement_date < b.enforcement_date ? -1 : 1;
    }
    const ra = a.law_revision_id ?? '';
    const rb = b.law_revision_id ?? '';
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  return { amendments, excludedCount };
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- pending-amendments`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/evidence-metadata.ts tests/pending-amendments.test.ts
git commit -m "feat(egov): add buildPendingAmendments (UnEnforced extract, deterministic sort, exclude count)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `getPendingAmendmentWarnings`

**Files:**
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/pending-amendments.test.ts`（追記）

**Interfaces:**
- Consumes: `PendingAmendment`、`WarningMessage`
- Produces: `getPendingAmendmentWarnings(built: { amendments: PendingAmendment[]; excludedCount: number }, lawTitle: string): WarningMessage[]`（code: `UNENFORCED_AMENDMENT_PENDING` / `PENDING_AMENDMENT_INCOMPLETE_DATA`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/pending-amendments.test.ts` に追記（import に `getPendingAmendmentWarnings` を追加）:

```ts
import { buildVersionPinnedUrl, buildPendingAmendments, getPendingAmendmentWarnings } from '../src/lib/evidence-metadata.js';
import type { PendingAmendment } from '../src/lib/types.js';

const pa = (o: Partial<PendingAmendment> & { enforcement_date: string }): PendingAmendment => ({ ...o });

describe('getPendingAmendmentWarnings', () => {
  it('空 → 警告なし', () => {
    expect(getPendingAmendmentWarnings({ amendments: [], excludedCount: 0 }, '労働基準法')).toEqual([]);
  });

  it('未施行あり → 件数・最も近い施行予定日（未ソートでも min）・法令名接頭・hedge', () => {
    const w = getPendingAmendmentWarnings({
      amendments: [pa({ enforcement_date: '2030-04-01' }), pa({ enforcement_date: '2027-04-01' })],
      excludedCount: 0,
    }, '労働安全衛生法');
    expect(w[0].code).toBe('UNENFORCED_AMENDMENT_PENDING');
    expect(w[0].message).toContain('労働安全衛生法: ');
    expect(w[0].message).toContain('現行施行版に対し');
    expect(w[0].message).toContain('未施行の改正が 2 件');
    expect(w[0].message).toContain('最も近い施行予定日 2027-04-01'); // 未ソート入力でも min
    expect(w[0].message).toContain('改正対象に含まれるとは限りません'); // hedge
    expect(w[0].message).not.toContain('法律第'); // 改正法名を列挙しない
  });

  it('廃止予定を改正と分けて数える', () => {
    const w = getPendingAmendmentWarnings({
      amendments: [pa({ enforcement_date: '2027-04-01', repeal_status: 'Repeal' }), pa({ enforcement_date: '2028-04-01', repeal_status: 'None' })],
      excludedCount: 0,
    }, '某法');
    expect(w[0].message).toContain('未施行の改正が 1 件');
    expect(w[0].message).toContain('廃止予定が 1 件');
  });

  it('excludedCount>0 → PENDING_AMENDMENT_INCOMPLETE_DATA を追加', () => {
    const w = getPendingAmendmentWarnings({ amendments: [pa({ enforcement_date: '2027-04-01' })], excludedCount: 2 }, '某法');
    expect(w.map((x) => x.code)).toContain('PENDING_AMENDMENT_INCOMPLETE_DATA');
    expect(w.find((x) => x.code === 'PENDING_AMENDMENT_INCOMPLETE_DATA')?.message).toContain('某法: ');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- pending-amendments`
Expected: FAIL（`getPendingAmendmentWarnings` is not a function）

- [ ] **Step 3: 実装を追加**

`src/lib/evidence-metadata.ts` の末尾に追加:

```ts
/**
 * 未施行改正の警告を返す（法令名接頭・誤帰属 hedge・改正/廃止分割・fail-safe）。純粋。
 * - amendments が1件以上 → UNENFORCED_AMENDMENT_PENDING（最も近い施行予定日は min で防御的）。
 * - excludedCount > 0 → PENDING_AMENDMENT_INCOMPLETE_DATA。
 */
export function getPendingAmendmentWarnings(
  built: { amendments: PendingAmendment[]; excludedCount: number },
  lawTitle: string,
): WarningMessage[] {
  const warnings: WarningMessage[] = [];
  const { amendments, excludedCount } = built;
  if (amendments.length > 0) {
    const repealCount = amendments.filter(
      (a) => a.repeal_status !== undefined && a.repeal_status !== 'None',
    ).length;
    const amendCount = amendments.length - repealCount;
    const nearest = amendments.reduce(
      (min, a) => (a.enforcement_date < min ? a.enforcement_date : min),
      amendments[0].enforcement_date,
    );
    const parts: string[] = [];
    if (amendCount > 0) parts.push(`未施行の改正が ${amendCount} 件`);
    if (repealCount > 0) parts.push(`廃止予定が ${repealCount} 件`);
    warnings.push({
      code: 'UNENFORCED_AMENDMENT_PENDING',
      message:
        `${lawTitle}: 現行施行版に対し、${parts.join('・')}予定されています（最も近い施行予定日 ${nearest}）。` +
        '※これは法令全体の改正予定であり、引用した条文が改正対象に含まれるとは限りません。' +
        '詳細は pending_amendments を参照してください。',
    });
  }
  if (excludedCount > 0) {
    warnings.push({
      code: 'PENDING_AMENDMENT_INCOMPLETE_DATA',
      message: `${lawTitle}: 一部の未施行改正で施行予定日が取得できませんでした（${excludedCount} 件）。`,
    });
  }
  return warnings;
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- pending-amendments`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/evidence-metadata.ts tests/pending-amendments.test.ts
git commit -m "feat(egov): add getPendingAmendmentWarnings (hedge, amendment/repeal split, fail-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: adapter / cache / egov-client `fetchLawRevisions`

**Files:**
- Modify: `src/lib/cache.ts`
- Modify: `src/lib/source-adapters/egov-source-adapter.ts`
- Modify: `src/lib/egov-client.ts`
- Test: `tests/pending-amendments.test.ts`（追記）

**Interfaces:**
- Consumes: `EgovLawRevisionsResponse`（Task 1）
- Produces: `egovSourceAdapter.fetchLawRevisions(lawId)`、`fetchLawRevisions(lawId)`（egov-client）、`lawRevisionsRawCache`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pending-amendments.test.ts` に追記:

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { fetchLawRevisions } from '../src/lib/egov-client.js';
import { lawRevisionsRawCache } from '../src/lib/cache.js';

describe('fetchLawRevisions (adapter+client)', () => {
  beforeEach(() => {
    lawRevisionsRawCache.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ law_info: { law_id: '347AC0000000057' }, revisions: [{ law_revision_id: 'x', current_revision_status: 'UnEnforced', amendment_enforcement_date: '2027-04-01' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('取得しキャッシュする（2回目は fetch を呼ばない）', async () => {
    const r1 = await fetchLawRevisions('347AC0000000057');
    const r2 = await fetchLawRevisions('347AC0000000057');
    expect(r1.revisions?.[0].current_revision_status).toBe('UnEnforced');
    expect(r2.revisions?.[0].law_revision_id).toBe('x');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- pending-amendments`
Expected: FAIL（`fetchLawRevisions` / `lawRevisionsRawCache` が未定義）

- [ ] **Step 3: 実装（cache）**

`src/lib/cache.ts` の `lawDataRawCache`（`export const lawDataRawCache = ...` ブロック）の直後に追加:

```ts
/** raw: e-Gov 法令履歴一覧 JSON */
export const lawRevisionsRawCache = new RawResponseCache<string>('law_revisions', {
  defaultTtlMs: 60 * 60 * 1000,
  maxEntries: 64,
  maxBytes: 2_000_000,
});
```

- [ ] **Step 4: 実装（adapter）**

`src/lib/source-adapters/egov-source-adapter.ts`:

(a) import を差し替え:

```ts
import { lawDataRawCache, lawRevisionsRawCache, lawSearchRawCache } from '../cache.js';
import type { EgovLawData, EgovLawRevisionsResponse, EgovLawSearchResult } from '../types.js';
```

(b) `fetchLawDataById` メソッドの直後に追加:

```ts
  async fetchLawRevisions(lawId: string): Promise<EgovLawRevisionsResponse> {
    const cached = lawRevisionsRawCache.get(lawId);
    if (cached) {
      return JSON.parse(cached) as EgovLawRevisionsResponse;
    }

    const url = `${this.baseUrl}/law_revisions/${lawId}`;
    const data = await this.fetchJson<EgovLawRevisionsResponse>(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    const serialized = JSON.stringify(data);
    if (serialized.length <= MAX_CACHEABLE_JSON_CHARS) {
      lawRevisionsRawCache.set(lawId, serialized);
    }

    return data;
  }
```

- [ ] **Step 5: 実装（egov-client）**

`src/lib/egov-client.ts`:

(a) import に型を追加（既存 `import type { EgovLawSearchResult, EgovLawData } from './types.js';` を拡張）:

```ts
import type { EgovLawSearchResult, EgovLawData, EgovLawRevisionsResponse } from './types.js';
```

(b) `getEgovUrl` の前（または `searchLaws` の後）に追加:

```ts
/**
 * 確定済み law_id の法令履歴一覧（/law_revisions）を取得
 */
export async function fetchLawRevisions(lawId: string): Promise<EgovLawRevisionsResponse> {
  const trimmed = lawId.trim();
  if (!trimmed) {
    throw new ValidationError('law_id を指定してください。');
  }
  return await egovSourceAdapter.fetchLawRevisions(trimmed);
}
```

- [ ] **Step 6: 成功を確認**

Run: `npm test -- pending-amendments`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/cache.ts src/lib/source-adapters/egov-source-adapter.ts src/lib/egov-client.ts tests/pending-amendments.test.ts
git commit -m "feat(egov): add fetchLawRevisions adapter/client + lawRevisionsRawCache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `law-service.getPendingAmendments` ＋ fixtures

**Files:**
- Modify: `src/lib/services/law-service.ts`
- Create: `tests/fixtures/egov/law-revisions-anei.json`, `tests/fixtures/egov/law-revisions-none.json`
- Test: `tests/pending-amendments.test.ts`（追記）

**Interfaces:**
- Consumes: `fetchLawRevisions`（Task 4）、`buildPendingAmendments`（Task 2）、`PendingAmendment`
- Produces: `getPendingAmendments(lawId): Promise<{ amendments: PendingAmendment[]; excludedCount: number }>`

- [ ] **Step 1: fixtures を作成**

`tests/fixtures/egov/law-revisions-anei.json`（UnEnforced: 2027-04-01×2〈同日 tie〉＋2030-04-01、除外1〈null date〉、CurrentEnforced/PreviousEnforced 各1。508 の版は `amendment_law_num:null`）:

```json
{
  "law_info": { "law_type": "Act", "law_id": "347AC0000000057", "law_num": "昭和四十七年法律第五十七号", "promulgation_date": "1972-06-08" },
  "revisions": [
    { "law_revision_id": "347AC0000000057_20300401_507AC0000000033", "amendment_enforcement_date": "2030-04-01", "amendment_enforcement_comment": null, "amendment_law_num": "令和七年法律第三十三号", "amendment_law_title": "労働安全衛生法及び作業環境測定法の一部を改正する法律", "amendment_law_id": "507AC0000000033", "current_revision_status": "UnEnforced", "repeal_status": "None", "repeal_date": null },
    { "law_revision_id": "347AC0000000057_20270401_508AC0000000089", "amendment_enforcement_date": "2027-04-01", "amendment_enforcement_comment": null, "amendment_law_num": null, "amendment_law_title": "労働安全衛生規則等の一部を改正する省令", "amendment_law_id": "508AC0000000089", "current_revision_status": "UnEnforced", "repeal_status": "None", "repeal_date": null },
    { "law_revision_id": "347AC0000000057_20270401_507AC0000000033", "amendment_enforcement_date": "2027-04-01", "amendment_enforcement_comment": null, "amendment_law_num": "令和七年法律第三十三号", "amendment_law_title": "労働安全衛生法及び作業環境測定法の一部を改正する法律", "amendment_law_id": "507AC0000000033", "current_revision_status": "UnEnforced", "repeal_status": "None", "repeal_date": null },
    { "law_revision_id": "347AC0000000057_99999999_508AC0000000090", "amendment_enforcement_date": null, "amendment_enforcement_comment": "政令で定める日", "amendment_law_num": "令和八年法律第九十号", "amendment_law_title": "未確定施行の改正法", "amendment_law_id": "508AC0000000090", "current_revision_status": "UnEnforced", "repeal_status": "None", "repeal_date": null },
    { "law_revision_id": "347AC0000000057_20260601_506AC0000000000", "amendment_enforcement_date": "2026-06-01", "current_revision_status": "CurrentEnforced", "repeal_status": "None" },
    { "law_revision_id": "347AC0000000057_20200401_500AC0000000000", "amendment_enforcement_date": "2020-04-01", "current_revision_status": "PreviousEnforced", "repeal_status": "None" }
  ]
}
```

`tests/fixtures/egov/law-revisions-none.json`（未施行なし）:

```json
{
  "law_info": { "law_type": "Act", "law_id": "322AC0000000049", "law_num": "昭和二十二年法律第四十九号", "promulgation_date": "1947-04-07" },
  "revisions": [
    { "law_revision_id": "322AC0000000049_20260624_508AC0000000046", "amendment_enforcement_date": "2026-06-24", "current_revision_status": "CurrentEnforced", "repeal_status": "None" },
    { "law_revision_id": "322AC0000000049_20200401_500AC0000000000", "amendment_enforcement_date": "2020-04-01", "current_revision_status": "PreviousEnforced", "repeal_status": "None" }
  ]
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/pending-amendments.test.ts` に追記（fixture を fetch stub で返し、`getPendingAmendments` を通す）:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPendingAmendments } from '../src/lib/services/law-service.js';

const aneiRevisions = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/law-revisions-anei.json', import.meta.url)), 'utf8'));

describe('law-service getPendingAmendments', () => {
  beforeEach(() => {
    lawRevisionsRawCache.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(aneiRevisions), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fixture から昇順 3 件＋excludedCount 1 を返す', async () => {
    const built = await getPendingAmendments('347AC0000000057');
    expect(built.amendments.map((a) => a.enforcement_date)).toEqual(['2027-04-01', '2027-04-01', '2030-04-01']);
    expect(built.amendments[0].law_revision_id).toBe('347AC0000000057_20270401_507AC0000000033'); // tie: 507 < 508
    expect(built.amendments[1].amendment_law_num).toBeUndefined(); // 508 版は null → undefined
    expect(built.excludedCount).toBe(1);
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- pending-amendments`
Expected: FAIL（`getPendingAmendments` is not exported）

- [ ] **Step 4: 実装を追加**

`src/lib/services/law-service.ts`:

(a) import を拡張:

```ts
import { fetchLawData, fetchLawRevisions, searchLaws, getEgovUrl } from '../egov-client.js';
import { buildPendingAmendments } from '../evidence-metadata.js';
```

（既存 `import type { EgovLawSearchResult, EgovRevisionInfo } from '../types.js';` に `PendingAmendment` を追加: `import type { EgovLawSearchResult, EgovRevisionInfo, PendingAmendment } from '../types.js';`）

(b) `getArticleByLawId` の後（または末尾付近）に追加:

```ts
export async function getPendingAmendments(
  lawId: string,
): Promise<{ amendments: PendingAmendment[]; excludedCount: number }> {
  const { revisions } = await fetchLawRevisions(lawId);
  return buildPendingAmendments(revisions);
}
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- pending-amendments`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/law-service.ts tests/fixtures/egov/law-revisions-anei.json tests/fixtures/egov/law-revisions-none.json tests/pending-amendments.test.ts
git commit -m "feat(egov): add law-service.getPendingAmendments + law_revisions fixtures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `get_article` 配線（input・schema・degrade）

**Files:**
- Modify: `src/lib/tool-contract.ts`
- Modify: `src/tools/get-article.ts`
- Test: `tests/get-article-pending.test.ts`（新規）

**Interfaces:**
- Consumes: `getPendingAmendments`（Task 5）、`getPendingAmendmentWarnings`（Task 3）、`PendingAmendment`、`observabilityRegistry`
- Produces: `pendingAmendmentSchema`（tool-contract）、`get_article` の `data.pending_amendments` ＋ opt-in input

- [ ] **Step 1: 共有 zod schema を追加**

`src/lib/tool-contract.ts` の `revisionMetadataSchema` 定義の直後に追加:

```ts
export const pendingAmendmentSchema = z.object({
  enforcement_date: z.string(),
  amendment_law_num: z.string().optional(),
  amendment_law_title: z.string().optional(),
  law_revision_id: z.string().optional(),
  version_pinned_url: z.string().optional(),
  enforcement_note: z.string().optional(),
  repeal_status: z.string().optional(),
});
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/get-article-pending.test.ts`（新規・`callTool`＋fetch stub で URL によって law_data / law_revisions を出し分け。law-service を mock しないため `vi.doUnmock` 不要）:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const laborFixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8'));
const aneiRevisions = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/law-revisions-anei.json', import.meta.url)), 'utf8'));

function stubFetch(revisionsResponder: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/law_revisions/')) return revisionsResponder(u);
    return new Response(JSON.stringify(laborFixture), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

describe('get_article pending amendments', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('省略時: /law_revisions を引かず pending_amendments は undefined・status ok', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.data.pending_amendments).toBeUndefined();
    expect((fetch as any).mock.calls.every((c: any[]) => !String(c[0]).includes('/law_revisions/'))).toBe(true);
  });

  it('true: pending_amendments（昇順3件）＋UNENFORCED_AMENDMENT_PENDING（hedge）・text に未施行節なし', async () => {
    stubFetch(() => new Response(JSON.stringify(aneiRevisions), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32', include_pending_amendments: true });
    expect(env.status).toBe('ok');
    expect(env.data.pending_amendments).toHaveLength(3);
    expect(env.data.pending_amendments[0].enforcement_date).toBe('2027-04-01');
    const w = env.warnings.find((x: any) => x.code === 'UNENFORCED_AMENDMENT_PENDING');
    expect(w.message).toContain('引用した条文が改正対象に含まれるとは限りません');
  });

  it('degrade: /law_revisions 失敗でも条文は返り status partial＋PENDING_AMENDMENT_CHECK_FAILED', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32', include_pending_amendments: true });
    expect(env.status).toBe('partial');
    expect(env.degraded).toBe(true);
    expect(env.data).not.toBeNull();
    expect(env.data.body).toBeTruthy(); // 条文は返る
    expect(env.data.pending_amendments).toBeUndefined();
    expect(env.partial_failures.some((f: any) => f.target.includes('law_revisions'))).toBe(true);
    expect(env.warnings.some((x: any) => x.code === 'PENDING_AMENDMENT_CHECK_FAILED')).toBe(true);
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- get-article-pending`
Expected: FAIL（`include_pending_amendments` 未対応・pending_amendments なし）

- [ ] **Step 4: 実装（get-article.ts）**

(a) import を追加/差し替え:

```ts
import { computeUpstreamHash, buildRevisionMetadata, buildVersionInfoString, getRevisionWarnings, getPendingAmendmentWarnings } from '../lib/evidence-metadata.js';
import { getArticleByLawId, getPendingAmendments } from '../lib/services/law-service.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope, revisionMetadataSchema, pendingAmendmentSchema } from '../lib/tool-contract.js';
import { observabilityRegistry } from '../lib/observability.js';
import type { PendingAmendment } from '../lib/types.js';
```

(b) `getArticleInputSchema` に `item` の後へ追加:

```ts
  include_pending_amendments: z.boolean().optional().describe(
    '未施行の改正（施行予定日つき）を検知して pending_amendments に載せる。別途 e-Gov /law_revisions を1回追引きするため既定 false。' +
    'false／省略時は未施行改正の有無を確認しない（「改正予定なし」を意味しない）。就業規則改定・compliance 監査で改正リスクを確認する場面で true を指定。'
  ),
```

(c) tool の `description` を差し替え（nudge 追加）:

```ts
      description: '確定済み law_id に対して、特定条文を厳密に取得する。resolve_law の後段で使用する。未施行の改正確認は既定で行わない（include_pending_amendments: true 指定時のみ）。',
```

(d) `getArticleOutputSchema` の data object、`revision_metadata: revisionMetadataSchema.optional(),` の後へ追加:

```ts
    pending_amendments: z.array(pendingAmendmentSchema).optional(),
```

(e) handler の envelope 構築を差し替え。現状の `const freshnessWarnings = ...` / `const revisionWarnings = ...` / `const envelope = { status: 'ok' as const, ..., warnings: [...freshnessWarnings, ...revisionWarnings], partial_failures: [], data: {..., upstream_hash: ...} }` を、以下に置換（条文取得 `result` は既に取得済み・v1 の title/body/versionInfo/revisionMetadata 計算はそのまま）:

```ts
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
        const warnings = [...freshnessWarnings, ...getRevisionWarnings(result.revisionInfo, result.lawTitle)];
        const partialFailures: Array<{ source: string; target: string; reason: string }> = [];
        let degraded = false;
        let pendingAmendments: PendingAmendment[] | undefined;

        // pending 取得は条文取得とは別の inner try/catch（失敗が条文成功を巻き添えない）
        if (args.include_pending_amendments === true) {
          try {
            const built = await getPendingAmendments(result.lawId);
            pendingAmendments = built.amendments;
            warnings.push(...getPendingAmendmentWarnings(built, result.lawTitle));
          } catch {
            degraded = true;
            partialFailures.push({ source: 'egov', target: `law_revisions:${result.lawId}`, reason: 'upstream_unavailable' });
            observabilityRegistry.recordPartialFailure('egov', 1);
            warnings.push({
              code: 'PENDING_AMENDMENT_CHECK_FAILED',
              message: `${result.lawTitle}: 未施行改正の確認に失敗しました。時間をおいて再試行してください。`,
            });
          }
        }

        const status: 'ok' | 'partial' = partialFailures.length > 0 ? 'partial' : 'ok';
        const envelope = {
          status,
          retryable: false,
          degraded,
          warnings,
          partial_failures: partialFailures,
          data: {
            source_type: 'egov' as const,
            canonical_id: buildEgovArticleCanonicalId(result.lawId, args.article, args.paragraph, args.item),
            law_id: result.lawId,
            law_title: result.lawTitle,
            article: args.article,
            paragraph: args.paragraph,
            item: args.item,
            title,
            body,
            source_url: result.egovUrl,
            retrieved_at: isoNow(),
            version_info: versionInfo,
            revision_metadata: revisionMetadata,
            pending_amendments: pendingAmendments,
            upstream_hash: computeUpstreamHash([result.lawId, title, body, result.egovUrl]),
          },
        };
```

（`title`/`body`/`versionInfo`/`revisionMetadata` の宣言は現状のまま handler 上部に残す。text 応答（`createToolResult` の第3引数）は**変更しない**——未施行節を足さない。）

- [ ] **Step 5: 成功を確認**

Run: `npm test -- get-article-pending`
Expected: PASS（3 テスト）

- [ ] **Step 6: 回帰確認**

Run: `npm test -- tool-wire-contract get-article-revision`
Expected: PASS（既存 get_article テストは `include_pending_amendments` 未指定ゆえ pending 経路に入らず不変）

- [ ] **Step 7: Commit**

```bash
git add src/lib/tool-contract.ts src/tools/get-article.ts tests/get-article-pending.test.ts
git commit -m "feat(egov): wire include_pending_amendments into get_article (opt-in, degrade)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: 全テスト**

Run: `npm test`
Expected: PASS（全 suite）。`.jp-labor-evidence-indexes/` 由来の失敗は `rm -rf .jp-labor-evidence-indexes` で復旧して再実行。

- [ ] **Step 2: build**

Run: `npm run build`
Expected: 成功（tsc エラーなし）

- [ ] **Step 3: release gate**

Run: `npm run release:check`
Expected: PASS

- [ ] **Step 4: verify（実挙動・ネットワーク時）**

`/verify` skill または手動で `get_article`（law_id `347AC0000000057`〈安衛法〉, article `66`, `include_pending_amendments: true`）を実行し、`pending_amendments` に複数施行日＋`UNENFORCED_AMENDMENT_PENDING`（hedge 付き）警告が載ること、`include_pending_amendments` 省略時は載らないことを確認。

- [ ] **Step 5: CHANGELOG**

`CHANGELOG.md` の `[Unreleased]` に追記:

```
### Added
- `get_article`: `include_pending_amendments`（既定 false）で e-Gov `/law_revisions` を追引きし、未施行の改正（施行予定日つき・段階施行の全ロードマップ）を `pending_amendments[]` として提供。誤帰属 hedge 付きの `UNENFORCED_AMENDMENT_PENDING` 警告を付与。取得失敗は graceful degrade（条文は返す・`status:'partial'`）
```

---

## Notes for the implementer

- **順序**: Task 1→6 は依存順。Task 6 は Task 1-5 全てに依存。
- **helper 純粋厳守**: `buildPendingAmendments` は入力 `revisions` を mutate しない（filter/map の新規配列を sort）。
- **degrade の要**: pending 取得は必ず**独立 inner try/catch**。外側 catch（`mapErrorToEnvelope`）に落とすと条文が `data:null` になる回帰。
- **テスト方式**: `get-article-pending.test.ts` は law-service を `vi.mock` せず `callTool`＋fetch stub（URL 出し分け）＋`vi.resetModules()` で実経路を通す——v1 の `vi.doUnmock` footgun には当たらない。
- **circuit breaker**: law_data 成功が `recordSuccess` でカウンタをリセットするため、law_revisions 失敗が law_data を巻き添えることはない（spec §3・実コード確認済み）。
