# e-Gov 改正メタ → Evidence.revision_metadata / version_info（現行版表示 v1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** e-Gov law_data レスポンスに既に含まれる `revision_info` を Evidence へ載せ、`get_article`／`get_evidence_bundle` が「現行版の施行日・改正法・版ステータス・版固定 URL」と「非現行版/廃止の警告」を返すようにする（追加ネットワークリクエストゼロ）。

**Architecture:** 内部型 `EgovLawData` に `revision_info?` を足し、`law-service` の戻り値（`GetLawArticleResult`/`GetLawTocResult`）経由で 2 ツールへ運ぶ。変換は `evidence-metadata.ts` の純粋関数 3 本（`buildRevisionMetadata` / `buildVersionInfoString` / `getRevisionWarnings`）へ集約。共有 zod スキーマは `tool-contract.ts` に置く。

**Tech Stack:** TypeScript (ESM, NodeNext)、zod、vitest、`@modelcontextprotocol/sdk`。

## Global Constraints

すべての Task はこれらを暗黙に含む（spec `docs/superpowers/specs/2026-07-13-egov-revision-version-info-design.md` より逐語）:

- **追加リクエストゼロ**: 既取得 `revision_info` のみを使う。`/law_revisions` 等の新エンドポイントは呼ばない。
- **防御的パース**: `EgovLawData.revision_info` と内部フィールドは全て optional/nullable。helper で `null`/空文字 → `undefined` に正規化してから出力（zod `.string().optional()` は `null` を弾くため必須）。
- **helper は純粋**: `NormalizedCache` は参照返し（`src/lib/cache.ts:53`）。引数の `revisionInfo` を mutate せず、読み取り→新値返却のみ。
- **施行日は ISO 固定**: `formatJstDate` を流用しない。施行日は法的暦日でありタイムスタンプではないため `" JST"` を付けない。
- **誤帰属回避**: 改正法名（`amendment_law_title`）・改正法番号は人間可読 `version_info` 文字列に載せない（構造化 `revision_metadata` のみ）。施行日には hedge を付す。
- **警告は全域＋完全シグネチャ**: `getRevisionWarnings(revisionInfo, lawTitle)` は入力領域に対し全域（未知 enum も fallback 文言）、message は `lawTitle` を接頭。
- **鮮度**: revision_info は raw law_data 取得由来で最大 1 時間 stale になり得るが要件上許容（版は施行日境界でしか変化しない）。`lawDataRawCache` の TTL は変更しない。
- **非対象**: `diff_revision`・deprecated `get_law` は本 v1 で version_info を強化しない。

**Commit trailer（全 commit 共通）**: メッセージ末尾に
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` を付す。

---

## File Structure

**Create:**
- `tests/revision-metadata.test.ts` — helper 3 本の単体テスト（Task 1-3）。
- `tests/get-article-revision.test.ts` — get_article の挙動テスト＋`callTool` 経由の outputSchema 検証（Task 5）。

**Modify:**
- `src/lib/types.ts` — `EgovRevisionInfo` / `RevisionMetadata` 型を追加、`EgovLawData.revision_info?` を追加（Task 1）。
- `src/lib/evidence-metadata.ts` — helper 3 本を追加（Task 1-3）。
- `src/lib/services/law-service.ts` — `GetLawArticleResult`/`GetLawTocResult` に `revisionInfo?` を追加、populate（Task 4）。
- `tests/fixtures/egov/labor-standards-law.json` — `revision_info` ブロックを追加（Task 4）。
- `src/lib/tool-contract.ts` — `revisionMetadataSchema`（共有 zod）を追加（Task 5）。
- `src/tools/get-article.ts` — helper 使用＋outputSchema 拡張＋警告 merge（Task 5）。
- `src/lib/services/evidence-bundle-service.ts` — `EvidenceRecord` 拡張＋primary/委任先で helper 使用＋警告経路（Task 6）。
- `src/tools/get-evidence-bundle.ts` — `evidenceSchema` に `revision_metadata` を追加（Task 6）。
- `src/lib/indexes/freshness-warnings.ts` — `BUNDLED_INDEX_AGED` 文言の companion fix（Task 7）。
- `tests/freshness-warnings.test.ts` — companion fix の文言 assertion（Task 7）。

---

## Task 1: revision 型 ＋ `buildRevisionMetadata`

**Files:**
- Modify: `src/lib/types.ts`（`EgovLawData` は 22-34 行。末尾に型追加）
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/revision-metadata.test.ts`（新規）

**Interfaces:**
- Produces:
  - `interface EgovRevisionInfo`（全フィールド `?: string | null`）
  - `interface RevisionMetadata`（全フィールド `?: string`）
  - `EgovLawData.revision_info?: EgovRevisionInfo`
  - `buildRevisionMetadata(revisionInfo?: EgovRevisionInfo): RevisionMetadata | undefined`

- [ ] **Step 1: 型を追加**

`src/lib/types.ts` の `EgovLawData` インターフェース内、`law_full_text: EgovNode;` の直後に `revision_info?: EgovRevisionInfo;` を追加し、`EgovNode` 定義の直前に 2 型を追加:

```ts
/** e-Gov law_data.revision_info の v1 で用いる部分集合（防御的に全 optional/nullable） */
export interface EgovRevisionInfo {
  law_revision_id?: string | null;
  amendment_enforcement_date?: string | null;
  amendment_enforcement_comment?: string | null;
  amendment_law_num?: string | null;
  amendment_law_title?: string | null;
  amendment_law_id?: string | null;
  current_revision_status?: string | null;
  repeal_status?: string | null;
  repeal_date?: string | null;
}

/** get_article / evidence-bundle の Evidence に載る機械可読 版メタ（すべて optional・null は含めない） */
export interface RevisionMetadata {
  law_revision_id?: string;
  current_enforcement_date?: string;
  enforcement_note?: string;
  amendment_law_num?: string;
  amendment_law_title?: string;
  current_revision_status?: string;
  repeal_status?: string;
  version_pinned_url?: string;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/revision-metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRevisionMetadata } from '../src/lib/evidence-metadata.js';
import type { EgovRevisionInfo } from '../src/lib/types.js';

describe('buildRevisionMetadata', () => {
  it('revision_info から機械可読メタへ写像し version_pinned_url を導出', () => {
    const revisionInfo: EgovRevisionInfo = {
      law_revision_id: '322AC0000000049_20260624_508AC0000000046',
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: null,
      amendment_law_num: '令和八年法律第四十六号',
      amendment_law_title: '民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律',
      amendment_law_id: '508AC0000000046',
      current_revision_status: 'CurrentEnforced',
      repeal_status: 'None',
      repeal_date: null,
    };
    const meta = buildRevisionMetadata(revisionInfo);
    expect(meta?.current_enforcement_date).toBe('2026-06-24');
    expect(meta?.amendment_law_num).toBe('令和八年法律第四十六号');
    expect(meta?.current_revision_status).toBe('CurrentEnforced');
    expect(meta?.version_pinned_url).toBe(
      'https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049_20260624_508AC0000000046',
    );
  });

  it('null / 空文字を undefined に正規化する（enforcement_note は含めない）', () => {
    const meta = buildRevisionMetadata({
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: null,
      repeal_date: '',
    });
    expect(meta?.current_enforcement_date).toBe('2026-06-24');
    expect(meta?.enforcement_note).toBeUndefined();
    expect(meta?.version_pinned_url).toBeUndefined();
  });

  it('revisionInfo が undefined または全欠落なら undefined', () => {
    expect(buildRevisionMetadata(undefined)).toBeUndefined();
    expect(buildRevisionMetadata({})).toBeUndefined();
    expect(buildRevisionMetadata({ amendment_law_num: null })).toBeUndefined();
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- revision-metadata`
Expected: FAIL（`buildRevisionMetadata` is not exported / not a function）

- [ ] **Step 4: 実装を追加**

`src/lib/evidence-metadata.ts` の先頭 import を差し替え、ファイル末尾に追加:

```ts
import { createHash } from 'node:crypto';
import type { EgovRevisionInfo, RevisionMetadata, WarningMessage } from './types.js';

const EGOV_LAW_DATA_API = 'https://laws.e-gov.go.jp/api/2/law_data';

/** null/空白のみ を undefined へ畳む */
function cleanValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * revision_info を Evidence 用の機械可読メタへ正規化する。
 * API 名 → 出力名の写像はここに固定（mis-map 防止）:
 *   current_enforcement_date ← amendment_enforcement_date
 *   enforcement_note         ← amendment_enforcement_comment
 * version_pinned_url は law_revision_id から導出。全フィールド欠落なら undefined。
 * 純粋関数（引数を mutate しない）。
 */
export function buildRevisionMetadata(
  revisionInfo?: EgovRevisionInfo,
): RevisionMetadata | undefined {
  if (!revisionInfo) return undefined;
  const lawRevisionId = cleanValue(revisionInfo.law_revision_id);
  const metadata: RevisionMetadata = {
    law_revision_id: lawRevisionId,
    current_enforcement_date: cleanValue(revisionInfo.amendment_enforcement_date),
    enforcement_note: cleanValue(revisionInfo.amendment_enforcement_comment),
    amendment_law_num: cleanValue(revisionInfo.amendment_law_num),
    amendment_law_title: cleanValue(revisionInfo.amendment_law_title),
    current_revision_status: cleanValue(revisionInfo.current_revision_status),
    repeal_status: cleanValue(revisionInfo.repeal_status),
    version_pinned_url: lawRevisionId
      ? `${EGOV_LAW_DATA_API}/${lawRevisionId}`
      : undefined,
  };
  const hasAny = Object.values(metadata).some((value) => value !== undefined);
  return hasAny ? metadata : undefined;
}
```

（`WarningMessage` は Task 3 で使う。この Step で import 済みにしておく。）

- [ ] **Step 5: 成功を確認**

Run: `npm test -- revision-metadata`
Expected: PASS（3 テスト）

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/evidence-metadata.ts tests/revision-metadata.test.ts
git commit -m "feat(egov): add EgovRevisionInfo/RevisionMetadata types + buildRevisionMetadata

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `buildVersionInfoString`

**Files:**
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/revision-metadata.test.ts`（追記）

**Interfaces:**
- Consumes: `EgovRevisionInfo`（Task 1）、既存 `joinVersionInfo`
- Produces: `buildVersionInfoString(lawNum: string | undefined, promulgationDate: string | undefined, revisionInfo?: EgovRevisionInfo): string | undefined`

- [ ] **Step 1: 失敗するテストを書く**

`tests/revision-metadata.test.ts` に追記（import に `buildVersionInfoString` を追加）:

```ts
import { buildRevisionMetadata, buildVersionInfoString } from '../src/lib/evidence-metadata.js';

describe('buildVersionInfoString', () => {
  it('base（法令番号 / 公布日）に施行日セグメント＋hedge を append する', () => {
    const s = buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
      amendment_law_title: '民法等の一部を改正する法律…整備法',
    });
    expect(s).toContain('昭和二十二年法律第四十九号');
    expect(s).toContain('1947-04-07');
    expect(s).toContain('現行版の施行日 2026-06-24');
    expect(s).toContain('引用した条文が改正されたとは限りません');
  });

  it('改正法名は文字列に載せない（誤帰属回避）', () => {
    const s = buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
      amendment_law_title: '民法等の一部を改正する法律…整備法',
      amendment_law_num: '令和八年法律第四十六号',
    });
    expect(s).not.toContain('整備法');
    expect(s).not.toContain('令和八年法律第四十六号');
  });

  it('revision または施行日が無ければ base のみへ degrade（JST を付けない）', () => {
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', undefined))
      .toBe('昭和二十二年法律第四十九号 / 1947-04-07');
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', { repeal_status: 'None' }))
      .toBe('昭和二十二年法律第四十九号 / 1947-04-07');
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
    })).not.toContain('JST');
  });

  it('施行期日規定（enforcement_note）があれば併記し裸の断定を避ける', () => {
    const s = buildVersionInfoString('某法律', '2000-01-01', {
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: '公布の日から起算して一年を超えない範囲内において政令で定める日',
    });
    expect(s).toContain('施行期日規定: 公布の日から起算して');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- revision-metadata`
Expected: FAIL（`buildVersionInfoString` is not a function）

- [ ] **Step 3: 実装を追加**

`src/lib/evidence-metadata.ts` の末尾に追加:

```ts
/**
 * 人間可読 version_info を組む。既存 base（法令番号 / 公布日）を変えず、
 * 現行版の施行日セグメント＋誤帰属 hedge を append する。改正法名は載せない。
 * revision または施行日が無ければ base のみへ graceful degrade。純粋関数。
 */
export function buildVersionInfoString(
  lawNum: string | undefined,
  promulgationDate: string | undefined,
  revisionInfo?: EgovRevisionInfo,
): string | undefined {
  const base = joinVersionInfo([lawNum, promulgationDate]);
  const enforcementDate = cleanValue(revisionInfo?.amendment_enforcement_date);
  if (!enforcementDate) return base;
  const note = cleanValue(revisionInfo?.amendment_enforcement_comment);
  const noteSuffix = note ? `（施行期日規定: ${note}）` : '';
  const segment =
    `現行版の施行日 ${enforcementDate}${noteSuffix}　` +
    '※この施行日は法令全体の現行版を指し、引用した条文が改正されたとは限りません';
  return joinVersionInfo([base, segment]);
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- revision-metadata`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/evidence-metadata.ts tests/revision-metadata.test.ts
git commit -m "feat(egov): add buildVersionInfoString (施行日 append + 誤帰属 hedge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `getRevisionWarnings`（全域・lawTitle 接頭）

**Files:**
- Modify: `src/lib/evidence-metadata.ts`
- Test: `tests/revision-metadata.test.ts`（追記）

**Interfaces:**
- Consumes: `EgovRevisionInfo`（Task 1）、`WarningMessage`（既存 `src/lib/types.ts`）
- Produces: `getRevisionWarnings(revisionInfo: EgovRevisionInfo | undefined, lawTitle: string): WarningMessage[]`（code は `LAW_NOT_CURRENTLY_ENFORCED`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/revision-metadata.test.ts` に追記（import に `getRevisionWarnings` を追加）:

```ts
import {
  buildRevisionMetadata,
  buildVersionInfoString,
  getRevisionWarnings,
} from '../src/lib/evidence-metadata.js';

describe('getRevisionWarnings', () => {
  it('現行版 / revision 欠落 なら空配列', () => {
    expect(getRevisionWarnings({ current_revision_status: 'CurrentEnforced', repeal_status: 'None' }, '労働基準法')).toEqual([]);
    expect(getRevisionWarnings(undefined, '労働基準法')).toEqual([]);
    expect(getRevisionWarnings({}, '労働基準法')).toEqual([]);
  });

  it('廃止（repeal_status=Repeal）で LAW_NOT_CURRENTLY_ENFORCED＋lawTitle 接頭＋廃止日', () => {
    const w = getRevisionWarnings({ repeal_status: 'Repeal', repeal_date: '2020-04-01' }, '旧・某法');
    expect(w[0]?.code).toBe('LAW_NOT_CURRENTLY_ENFORCED');
    expect(w[0]?.message).toContain('旧・某法: ');
    expect(w[0]?.message).toContain('廃止されています');
    expect(w[0]?.message).toContain('2020-04-01');
  });

  it('current_revision_status 単独（PreviousEnforced）でも発火', () => {
    const w = getRevisionWarnings({ current_revision_status: 'PreviousEnforced' }, '某法');
    expect(w[0]?.message).toContain('過去の施行版');
  });

  it('未知 enum 値でも fallback 文言を返す（全域性）', () => {
    const w = getRevisionWarnings({ current_revision_status: 'SomeNewStatus' }, '某法');
    expect(w).toHaveLength(1);
    expect(w[0]?.code).toBe('LAW_NOT_CURRENTLY_ENFORCED');
    expect(w[0]?.message).toContain('現行施行版ではない可能性');
    expect(w[0]?.message).toContain('SomeNewStatus');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- revision-metadata`
Expected: FAIL（`getRevisionWarnings` is not a function）

- [ ] **Step 3: 実装を追加**

`src/lib/evidence-metadata.ts` の末尾に追加:

```ts
/**
 * 現行施行版でない版・廃止/失効法令に対する警告を返す（入力領域に対し全域）。
 * トリガ: current_revision_status が {undefined, 'CurrentEnforced'} 以外
 *         または repeal_status が {undefined, 'None'} 以外。
 * 既知 enum は状態別文言、未知の非現行値は fail-safe の汎用文言（raw 値併記）。
 * message は lawTitle を接頭。revisionInfo 欠落・現行版時は空配列。純粋関数。
 */
export function getRevisionWarnings(
  revisionInfo: EgovRevisionInfo | undefined,
  lawTitle: string,
): WarningMessage[] {
  if (!revisionInfo) return [];
  const status = cleanValue(revisionInfo.current_revision_status);
  const repeal = cleanValue(revisionInfo.repeal_status);
  const repealActive = repeal !== undefined && repeal !== 'None';
  const notCurrent = status !== undefined && status !== 'CurrentEnforced';
  if (!repealActive && !notCurrent) return [];

  const repealDate = cleanValue(revisionInfo.repeal_date);
  let body: string;
  if (repeal === 'Repeal' || status === 'Repeal') {
    body = `この法令は廃止されています${repealDate ? `（廃止日: ${repealDate}）` : ''}。現に効力を有しません。現行の法令を確認してください。`;
  } else if (repeal === 'Expire') {
    body = `この法令は期間満了により失効しています${repealDate ? `（失効日: ${repealDate}）` : ''}。現に効力を有しません。`;
  } else if (repeal === 'LossOfEffectiveness') {
    body = 'この法令は効力を喪失しています。現に効力を有しません。';
  } else if (repeal === 'Suspend') {
    body = 'この法令は効力が停止されています。適用の可否を確認してください。';
  } else if (status === 'UnEnforced') {
    body = 'この版はまだ施行されていません（未施行）。現在の施行版とは内容が異なる可能性があります。';
  } else if (status === 'PreviousEnforced') {
    body = 'この版は過去の施行版であり、現行版ではありません。より新しい施行版が存在します。';
  } else {
    const rawState = repealActive ? repeal : status;
    body = `この法令は現行施行版ではない可能性があります（状態: ${rawState}）。現行の法令を確認してください。`;
  }
  return [{ code: 'LAW_NOT_CURRENTLY_ENFORCED', message: `${lawTitle}: ${body}` }];
}
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- revision-metadata`
Expected: PASS（全 describe）

- [ ] **Step 5: Commit**

```bash
git add src/lib/evidence-metadata.ts tests/revision-metadata.test.ts
git commit -m "feat(egov): add getRevisionWarnings (total over enum domain, lawTitle prefix)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `law-service` に revisionInfo を通す ＋ fixture

**Files:**
- Modify: `src/lib/services/law-service.ts`（`GetLawArticleResult` 18-27 / `GetLawTocResult` 29-36 / `getLawArticle` payload 126-135 / `getLawToc` payload 159-167）
- Modify: `tests/fixtures/egov/labor-standards-law.json`
- Test: `tests/revision-metadata.test.ts`（law-service populate の統合ケースを追記）

**Interfaces:**
- Consumes: `EgovRevisionInfo`（Task 1）
- Produces: `GetLawArticleResult.revisionInfo?: EgovRevisionInfo`、`GetLawTocResult.revisionInfo?: EgovRevisionInfo`（Task 5/6 が消費）

- [ ] **Step 1: fixture に revision_info を追加**

`tests/fixtures/egov/labor-standards-law.json` のトップレベル（`law_full_text` と同階層）に追加。`amendment_enforcement_comment` と `repeal_date` を **`null`** にして C1（null → validation）回帰を fixture 側で担保する:

```json
  "revision_info": {
    "law_revision_id": "322AC0000000049_20260624_508AC0000000046",
    "amendment_enforcement_date": "2026-06-24",
    "amendment_enforcement_comment": null,
    "amendment_law_num": "令和八年法律第四十六号",
    "amendment_law_title": "民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律",
    "amendment_law_id": "508AC0000000046",
    "current_revision_status": "CurrentEnforced",
    "repeal_status": "None",
    "repeal_date": null
  }
```

（既存の `law_info` / `law_full_text` は変更しない。JSON の末尾カンマに注意——`law_full_text` の後に `,` を付け、`revision_info` を追加。）

- [ ] **Step 2: 失敗するテストを書く**

`tests/revision-metadata.test.ts` に追記。global `fetch` を stub し、adapter の raw cache を clear してから `getLawArticle` を呼ぶ:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getLawArticle } from '../src/lib/services/law-service.js';
import { lawDataRawCache } from '../src/lib/cache.js';

const laborFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8'),
);

describe('law-service revisionInfo populate', () => {
  beforeEach(() => {
    lawDataRawCache.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(laborFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getLawArticle が data.revision_info を revisionInfo に載せる', async () => {
    const result = await getLawArticle({ lawName: '322AC0000000049', article: '32' });
    expect(result.revisionInfo?.amendment_enforcement_date).toBe('2026-06-24');
    expect(result.revisionInfo?.current_revision_status).toBe('CurrentEnforced');
  });
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- revision-metadata`
Expected: FAIL（`result.revisionInfo` is undefined — 型に無く populate もされていない）

- [ ] **Step 4: 実装を追加**

`src/lib/services/law-service.ts`:

(a) import に型を追加（既存の `import type { EgovLawSearchResult } from '../types.js';` を拡張）:

```ts
import type { EgovLawSearchResult, EgovRevisionInfo } from '../types.js';
```

(b) `GetLawArticleResult` インターフェースの `egovUrl: string;` の後に追加:

```ts
  revisionInfo?: EgovRevisionInfo;
```

(c) `GetLawTocResult` インターフェースの `egovUrl: string;` の後に同じく追加:

```ts
  revisionInfo?: EgovRevisionInfo;
```

(d) `getLawArticle` の `payload`（126-135 行）に `egovUrl,` の後へ追加:

```ts
    revisionInfo: data.revision_info,
```

(e) `getLawToc` の `payload`（159-167 行）に `egovUrl,` の後へ追加:

```ts
    revisionInfo: data.revision_info,
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- revision-metadata`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/law-service.ts tests/fixtures/egov/labor-standards-law.json tests/revision-metadata.test.ts
git commit -m "feat(egov): thread revision_info through law-service results + fixture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `get_article` を配線（outputSchema ＋ helper ＋ 警告）

**Files:**
- Modify: `src/lib/tool-contract.ts`（共有 `revisionMetadataSchema`）
- Modify: `src/tools/get-article.ts`
- Test: `tests/get-article-revision.test.ts`（新規）

**Interfaces:**
- Consumes: `buildRevisionMetadata`/`buildVersionInfoString`/`getRevisionWarnings`（Task 1-3）、`GetLawArticleResult.revisionInfo`（Task 4）
- Produces: `revisionMetadataSchema`（`tool-contract.ts` から export、Task 6 が消費）、`get_article` の `data.revision_metadata`

- [ ] **Step 1: 共有 zod スキーマを追加**

`src/lib/tool-contract.ts` の `partialFailureSchema` 定義の後に追加:

```ts
export const revisionMetadataSchema = z.object({
  law_revision_id: z.string().optional(),
  current_enforcement_date: z.string().optional(),
  enforcement_note: z.string().optional(),
  amendment_law_num: z.string().optional(),
  amendment_law_title: z.string().optional(),
  current_revision_status: z.string().optional(),
  repeal_status: z.string().optional(),
  version_pinned_url: z.string().optional(),
});
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/get-article-revision.test.ts`（新規）。2 系統: (A) 挙動（law-service を mock し handler 直呼び）、(B) outputSchema 検証（`callTool`＋`createServer`＋fetch stub、C1 の null 経路）:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from '../src/lib/indexes/egov-index.js';
import { callTool } from './test-helpers/mcp-internals.js';

// --- (A) 挙動テスト: law-service を mock し handler を直呼び ---
vi.mock('../src/lib/services/law-service.js', () => ({
  searchLaw: vi.fn(),
  getLawArticle: vi.fn(),
  getLawToc: vi.fn(),
  resolveLaw: vi.fn(),
  getArticleByLawId: vi.fn(),
  findRelatedSources: vi.fn(),
}));

import { getArticleByLawId } from '../src/lib/services/law-service.js';
import { registerGetArticleTool } from '../src/tools/get-article.js';

function stubServer(registerTool: ReturnType<typeof vi.fn>): McpServer {
  return { registerTool } as unknown as McpServer;
}

describe('get_article revision (挙動)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(getEgovIndexMeta().generated_at));
    vi.resetAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('現行版: revision_metadata と強化 version_info を返し警告なし', async () => {
    const registerTool = vi.fn();
    registerGetArticleTool(stubServer(registerTool));
    const [, , handler] = registerTool.mock.calls[0];
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049', lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号', promulgationDate: '1947-04-07',
      article: '32', articleCaption: '労働時間', text: '使用者は...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      revisionInfo: {
        law_revision_id: '322AC0000000049_20260624_508AC0000000046',
        amendment_enforcement_date: '2026-06-24',
        current_revision_status: 'CurrentEnforced', repeal_status: 'None',
      },
    });
    const result = await handler({ law_id: '322AC0000000049', article: '32' });
    expect(result.structuredContent.data.revision_metadata.current_enforcement_date).toBe('2026-06-24');
    expect(result.structuredContent.data.revision_metadata.version_pinned_url).toContain('/api/2/law_data/');
    expect(result.structuredContent.data.version_info).toContain('現行版の施行日 2026-06-24');
    expect(result.structuredContent.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(false);
  });

  it('廃止法令: LAW_NOT_CURRENTLY_ENFORCED を法令名接頭で返す', async () => {
    const registerTool = vi.fn();
    registerGetArticleTool(stubServer(registerTool));
    const [, , handler] = registerTool.mock.calls[0];
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '000AC0000000000', lawTitle: '旧・某法',
      lawNum: '某法律', promulgationDate: '1950-01-01',
      article: '1', articleCaption: '', text: '...',
      egovUrl: 'https://laws.e-gov.go.jp/law/000AC0000000000',
      revisionInfo: { repeal_status: 'Repeal', repeal_date: '2020-04-01' },
    });
    const result = await handler({ law_id: '000AC0000000000', article: '1' });
    const w = result.structuredContent.warnings.find((x: any) => x.code === 'LAW_NOT_CURRENTLY_ENFORCED');
    expect(w?.message).toContain('旧・某法: ');
    expect(w?.message).toContain('廃止されています');
  });
});

// --- (B) outputSchema 検証: callTool 経由（C1: null を弾かない） ---
const laborFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/egov/labor-standards-law.json', import.meta.url)), 'utf8'),
);

describe('get_article revision (outputSchema 検証)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(laborFixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('null を含む revision_info でも outputSchema validation を通過する', async () => {
    const { createServer } = await import('../src/server.js');
    const server = createServer();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.data.revision_metadata.current_enforcement_date).toBe('2026-06-24');
    // null 由来フィールドは undefined 化され validation error を起こさない
    expect(env.data.revision_metadata.enforcement_note).toBeUndefined();
  }, 30000);
});
```

- [ ] **Step 3: 失敗を確認**

Run: `npm test -- get-article-revision`
Expected: FAIL（`data.revision_metadata` undefined / version_info に施行日なし / callTool で validation error か revision_metadata 欠落）

- [ ] **Step 4: 実装を追加**

`src/tools/get-article.ts`:

(a) import を差し替え:

```ts
import { computeUpstreamHash, buildRevisionMetadata, buildVersionInfoString, getRevisionWarnings } from '../lib/evidence-metadata.js';
import { createToolEnvelopeSchema, createToolResult, isoNow, mapErrorToEnvelope, revisionMetadataSchema } from '../lib/tool-contract.js';
```

（既存の `import { computeUpstreamHash, joinVersionInfo } from '../lib/evidence-metadata.js';` は `joinVersionInfo` を使わなくなるので上記1行へ置換。既存の tool-contract import 行に `revisionMetadataSchema` を追加。）

(b) `getArticleOutputSchema` の `version_info: z.string().optional(),` の後に追加:

```ts
    revision_metadata: revisionMetadataSchema.optional(),
```

(c) handler 内の既存2行（66-67 行）を置換する。before:

```ts
        const versionInfo = joinVersionInfo([result.lawNum, result.promulgationDate]);
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
```

after（`freshnessWarnings` は重複させず1つに保つ）:

```ts
        const versionInfo = buildVersionInfoString(result.lawNum, result.promulgationDate, result.revisionInfo);
        const revisionMetadata = buildRevisionMetadata(result.revisionInfo);
        const freshnessWarnings = toWireWarnings(getIndexWarningsForTool(['egov']));
        const revisionWarnings = getRevisionWarnings(result.revisionInfo, result.lawTitle);
```

(d) `envelope` の `warnings` と `data` を更新:

```ts
          warnings: [...freshnessWarnings, ...revisionWarnings],
```

`data` 内、`version_info: versionInfo,` の後に追加:

```ts
            revision_metadata: revisionMetadata,
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- get-article-revision`
Expected: PASS（3 テスト）

- [ ] **Step 6: 回帰確認**

Run: `npm test -- tool-wire-contract`
Expected: PASS（既存 `version_info` は `toContain('昭和')` のみ検証ゆえ不変）

- [ ] **Step 7: Commit**

```bash
git add src/lib/tool-contract.ts src/tools/get-article.ts tests/get-article-revision.test.ts
git commit -m "feat(egov): surface revision_metadata/version_info/warning in get_article

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `get_evidence_bundle` を配線（primary ＋ 委任先 toc）

**Files:**
- Modify: `src/lib/services/evidence-bundle-service.ts`（`EvidenceRecord` 9-31 / primary 69-85 / warnings 97 / 委任先 105-115）
- Modify: `src/tools/get-evidence-bundle.ts`（`evidenceSchema` 27-56）
- Test: `tests/evidence-bundle-service.test.ts`（追記）

**Interfaces:**
- Consumes: helper 3 本（Task 1-3）、`revisionMetadataSchema`（Task 5）、`GetLawArticleResult.revisionInfo`/`GetLawTocResult.revisionInfo`（Task 4）
- Produces: bundle の `primary_evidence.revision_metadata` ＋ top-level 警告

- [ ] **Step 1: 失敗するテストを書く**

`tests/evidence-bundle-service.test.ts` の既存 describe 内に追記（`getArticleByLawId` の mock 戻り値に `revisionInfo` を足すケース）:

```ts
  it('primary_evidence に revision_metadata と強化 version_info を載せ、非現行なら top-level 警告', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '000AC0000000000', lawTitle: '旧・某法',
      lawNum: '某法律', promulgationDate: '1950-01-01',
      article: '1', articleCaption: '', text: '...',
      egovUrl: 'https://laws.e-gov.go.jp/law/000AC0000000000',
      revisionInfo: { repeal_status: 'Repeal', repeal_date: '2020-04-01' },
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '000AC0000000000', lawTitle: '旧・某法',
      delegatedLaws: [], searchKeywords: [], warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({ results: [], warnings: [], failedPages: [] } as any);

    const bundle = await getEvidenceBundle({ lawId: '000AC0000000000', article: '1', includeJaish: false });
    expect(bundle.primary_evidence.revision_metadata?.repeal_status).toBe('Repeal');
    expect(bundle.warnings.some((w) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED' && w.message.includes('旧・某法'))).toBe(true);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- evidence-bundle-service`
Expected: FAIL（`revision_metadata` undefined / 警告なし）

- [ ] **Step 3: 実装を追加（service）**

`src/lib/services/evidence-bundle-service.ts`:

(a) import 追加:

```ts
import { computeUpstreamHash, joinVersionInfo, buildRevisionMetadata, buildVersionInfoString, getRevisionWarnings } from '../evidence-metadata.js';
import type { PartialFailure, WarningMessage, RevisionMetadata } from '../types.js';
```

（既存の evidence-metadata import と types import を上記へ拡張。）

(b) `EvidenceRecord` の `version_info?: string;` の後に追加:

```ts
  revision_metadata?: RevisionMetadata;
```

(c) `primaryEvidence`（69-85 行）の `version_info` を置換し `revision_metadata` を追加:

```ts
    version_info: buildVersionInfoString(primary.lawNum, primary.promulgationDate, primary.revisionInfo),
    revision_metadata: buildRevisionMetadata(primary.revisionInfo),
```

(d) primaryEvidence 定義の直後（`const related = await findRelatedSources(...)` の前）に追加:

```ts
  const primaryRevisionWarnings = getRevisionWarnings(primary.revisionInfo, primary.lawTitle);
```

(e) `const warnings: WarningMessage[] = [...related.warnings];`（97 行）を置換:

```ts
  const warnings: WarningMessage[] = [...primaryRevisionWarnings, ...related.warnings];
```

(f) 委任先 toc の `delegatedEvidence.push({...})`（105-115 行）内、`version_info` を置換し `revision_metadata` を追加:

```ts
        version_info: buildVersionInfoString(toc.lawNum, toc.promulgationDate, toc.revisionInfo),
        revision_metadata: buildRevisionMetadata(toc.revisionInfo),
```

(g) 同じ `try` ブロック内、`delegatedEvidence.push(...)` の直後に委任先の警告を追加:

```ts
      warnings.push(...getRevisionWarnings(toc.revisionInfo, delegatedLaw.lawTitle));
```

- [ ] **Step 4: 実装を追加（tool schema）**

`src/tools/get-evidence-bundle.ts`:

(a) import に `revisionMetadataSchema` を追加（既存 `createToolEnvelopeSchema, createToolResult, mapErrorToEnvelope` の行）:

```ts
import { createToolEnvelopeSchema, createToolResult, mapErrorToEnvelope, revisionMetadataSchema } from '../lib/tool-contract.js';
```

(b) `evidenceSchema` の `version_info: z.string().optional(),`（38 行）の後に追加:

```ts
  revision_metadata: revisionMetadataSchema.optional(),
```

- [ ] **Step 5: 成功を確認**

Run: `npm test -- evidence-bundle-service evidence-bundle-tool`
Expected: PASS（新規＋既存）

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/evidence-bundle-service.ts src/tools/get-evidence-bundle.ts tests/evidence-bundle-service.test.ts
git commit -m "feat(egov): surface revision_metadata/version_info/warning in evidence bundle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: companion fix（freshness 警告文の過大約束是正）

**Files:**
- Modify: `src/lib/indexes/freshness-warnings.ts`（`getBundledIndexWarnings` の message、68 行）
- Test: `tests/freshness-warnings.test.ts`（35-44 行の BUNDLED_INDEX_AGED ケースに追記）

**Interfaces:** なし（文言のみ）

- [ ] **Step 1: 失敗するテストを書く**

`tests/freshness-warnings.test.ts` の「60日を超えると BUNDLED_INDEX_AGED を返す」テスト（35-44 行付近）に assertion を追記:

```ts
      // companion fix: 本文 live ゆえ過大約束しない・内部用語を平易化
      expect(warnings[0]?.message).toContain('本文の更新に再起動は不要');
      expect(warnings[0]?.message).toContain('内蔵の法令リスト');
      expect(warnings[0]?.message).not.toContain('最新の法令改正を反映するには');
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- freshness-warnings`
Expected: FAIL（現行文言は「最新の法令改正を反映するには」を含み、新フレーズを含まない）

- [ ] **Step 3: 実装を追加**

`src/lib/indexes/freshness-warnings.ts` の `getBundledIndexWarnings` 内 `const message = ...`（68 行）を置換:

```ts
  const message = `内蔵法令インデックスの生成から ${ageDays} 日経過しています（生成日: ${formatJstDate(generatedMs)}）${boundaryNote}。なお条文の本文は常に最新の現行版をオンライン取得するため、本文の更新に再起動は不要です。この警告が対象とするのは内蔵の法令リスト（法令名・略称から法令を特定するための対応表）で、新しく制定・改称された法令を検索できるようにするには Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動なら再起動で最新パッケージを自動取得。グローバルインストールは \`npm update -g jp-labor-evidence-mcp\`）。`;
```

- [ ] **Step 4: 成功を確認**

Run: `npm test -- freshness-warnings`
Expected: PASS（既存の `再起動`/`npm update -g jp-labor-evidence-mcp`/`61 日` も新文言に含まれるため不変）

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes/freshness-warnings.ts tests/freshness-warnings.test.ts
git commit -m "fix(egov): scope BUNDLED_INDEX_AGED wording to resolution map (本文 live)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: 全テスト**

Run: `npm test`
Expected: PASS（全 suite）。もし `.jp-labor-evidence-indexes/` 由来の `ENTRY_COUNT_DROP` 系で初回失敗したら `rm -rf .jp-labor-evidence-indexes` で復旧して再実行（CLAUDE.md Gotchas）。

- [ ] **Step 2: build**

Run: `npm run build`
Expected: 成功（tsc エラーなし）

- [ ] **Step 3: release gate（型・pack 込み）**

Run: `npm run release:check`
Expected: PASS

- [ ] **Step 4: verify（実挙動）**

`/verify` skill または手動で `get_article`（law_id `322AC0000000049`, article `32`）を実行し、`version_info` に「現行版の施行日」と hedge、`revision_metadata` に `version_pinned_url` が載ることを確認（ネットワーク接続時）。

- [ ] **Step 5: CHANGELOG**

`CHANGELOG.md` の `[Unreleased]` に追記（version bump は spec §9 のとおり次 minor 相乗り時に別途判断）:

```
### Added
- `get_article` / `get_evidence_bundle`: e-Gov revision_info から現行版の施行日・改正法・版固定 URL（`revision_metadata`）と非現行版/廃止の警告（`LAW_NOT_CURRENTLY_ENFORCED`）を提供
### Changed
- `BUNDLED_INDEX_AGED` 警告文を是正（本文は常に live 取得のため再起動不要である旨を明記）
```

---

## Notes for the implementer

- **順序**: Task 1→7 は依存順。Task 5 は Task 1-4 全てに依存、Task 6 は Task 5（`revisionMetadataSchema`）に依存。
- **既存パターン厳守**: tool 挙動テストは law-service を `vi.mock`、`callTool` 統合は `createServer()`＋fetch stub＋`vi.resetModules()`。時刻依存は `vi.setSystemTime(new Date(getEgovIndexMeta().generated_at))` で egov を fresh 固定。
- **helper 純粋厳守**: `NormalizedCache` は参照返し。helper 内で引数 `revisionInfo` を書き換えない。
- **非対象を触らない**: `diff_revision`（`diff-revision-service.ts:120`）・`get_law` は本 plan で変更しない。
