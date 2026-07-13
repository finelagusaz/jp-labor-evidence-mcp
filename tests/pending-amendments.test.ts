import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVersionPinnedUrl, buildPendingAmendments, getPendingAmendmentWarnings } from '../src/lib/evidence-metadata.js';
import { fetchLawRevisions } from '../src/lib/egov-client.js';
import { lawRevisionsRawCache } from '../src/lib/cache.js';
import type { EgovRevisionInfo, PendingAmendment } from '../src/lib/types.js';

const rev = (o: Partial<EgovRevisionInfo>): EgovRevisionInfo => ({ ...o });
const pa = (o: Partial<PendingAmendment> & { enforcement_date: string }): PendingAmendment => ({ ...o });

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
