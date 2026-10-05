import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildRevisionMetadata,
  getRevisionWarnings,
  isLatestEnforcedRevision,
} from '../src/lib/evidence-metadata.js';
import type { EgovRevisionInfo } from '../src/lib/types.js';
import { callTool } from './test-helpers/mcp-internals.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8'));

const laborFixture = fixture('labor-standards-law.json');
// 労働組合法の live /law_revisions（2026-10-04 取得）。最新の施行版 20260624 が PreviousEnforced のまま
const rosoRevisions = fixture('law-revisions-roso-stale-tag.json');
const rosoLatest: EgovRevisionInfo = rosoRevisions.revisions.find(
  (r: EgovRevisionInfo) => r.law_revision_id === '324AC0000000174_20260624_508AC0000000046',
);

// 2026-10-04 09:00 JST
const NOW = Date.parse('2026-10-04T00:00:00.000Z');
const isLatest = (t: EgovRevisionInfo, revisions: EgovRevisionInfo[] | undefined, now = NOW) =>
  isLatestEnforcedRevision(t, revisions, now);

const rev = (overrides: Partial<EgovRevisionInfo>): EgovRevisionInfo => ({
  repeal_status: 'None',
  ...overrides,
});
const target = rev({
  law_revision_id: 'L_20260624',
  amendment_enforcement_date: '2026-06-24',
  current_revision_status: 'PreviousEnforced',
});
const older = rev({
  law_revision_id: 'L_20251001',
  amendment_enforcement_date: '2025-10-01',
  current_revision_status: 'PreviousEnforced',
});
const pending = rev({
  law_revision_id: 'L_20281223',
  amendment_enforcement_date: '2028-12-23',
  current_revision_status: 'UnEnforced',
});

describe('isLatestEnforcedRevision', () => {
  it('live の労組法: 最新の施行版が PreviousEnforced でも施行済みの最新版と判定する', () => {
    expect(rosoLatest?.current_revision_status).toBe('PreviousEnforced');
    expect(isLatest(rosoLatest, rosoRevisions.revisions)).toBe(true);
  });

  it('他が古い施行版と未施行版だけなら true（UnEnforced は施行日が後でも無視）', () => {
    expect(isLatest(target, [pending, target, older])).toBe(true);
  });

  it('施行日の無い UnEnforced は無視する', () => {
    const undated = rev({ law_revision_id: 'L_x', current_revision_status: 'UnEnforced' });
    expect(isLatest(target, [undated, target, older])).toBe(true);
  });

  it('より後の施行日の施行版があれば false', () => {
    const newer = rev({ law_revision_id: 'L_20261001', amendment_enforcement_date: '2026-10-01', current_revision_status: 'PreviousEnforced' });
    expect(isLatest(target, [newer, target, older])).toBe(false);
  });

  it('target 以外に CurrentEnforced があれば、施行日が古くても false', () => {
    const current = rev({ law_revision_id: 'L_20200401', amendment_enforcement_date: '2020-04-01', current_revision_status: 'CurrentEnforced' });
    expect(isLatest(target, [target, current])).toBe(false);
  });

  it('同じ施行日の別の施行版があれば順序が決まらないので false', () => {
    const sameDay = rev({ law_revision_id: 'L_20260624_other', amendment_enforcement_date: '2026-06-24', current_revision_status: 'PreviousEnforced' });
    expect(isLatest(target, [sameDay, target, older])).toBe(false);
  });

  it('同じ施行日でも UnEnforced なら無視して true', () => {
    const sameDayPending = rev({ law_revision_id: 'L_20260624_p', amendment_enforcement_date: '2026-06-24', current_revision_status: 'UnEnforced' });
    expect(isLatest(target, [sameDayPending, target, older])).toBe(true);
  });

  it('施行日の無い他の施行版があれば false', () => {
    const undated = rev({ law_revision_id: 'L_undated', current_revision_status: 'PreviousEnforced' });
    expect(isLatest(target, [target, undated])).toBe(false);
  });

  it('target の law_revision_id が一覧に無ければ false', () => {
    expect(isLatest(target, [older, pending])).toBe(false);
  });

  it('target の施行日・law_revision_id が無ければ false', () => {
    const noDate = { ...target, amendment_enforcement_date: null };
    expect(isLatest(noDate, [noDate, older])).toBe(false);
    const noId = { ...target, law_revision_id: null };
    expect(isLatest(noId, [noId, older])).toBe(false);
  });

  it('一覧が undefined・空なら false', () => {
    expect(isLatest(target, undefined)).toBe(false);
    expect(isLatest(target, [])).toBe(false);
  });

  it('target の施行日が今日（JST）より後なら false', () => {
    const future = { ...target, amendment_enforcement_date: '2026-10-05' };
    expect(isLatest(future, [future, older])).toBe(false);
  });

  it('今日の判定は JST の暦日で行う（UTC ではまだ前日でも当日施行の版は true）', () => {
    const today = { ...target, amendment_enforcement_date: '2026-10-01' };
    // 2026-10-01 00:30 JST = 2026-09-30T15:30Z
    expect(isLatest(today, [today, older], Date.parse('2026-09-30T15:30:00.000Z'))).toBe(true);
    // 2026-09-30 23:30 JST
    expect(isLatest(today, [today, older], Date.parse('2026-09-30T14:30:00.000Z'))).toBe(false);
  });
});

describe('latestEnforcedVerified オプション', () => {
  it('照合済みの PreviousEnforced には LAW_NOT_CURRENTLY_ENFORCED を出さない', () => {
    expect(getRevisionWarnings(target, '労働組合法', { latestEnforcedVerified: true })).toEqual([]);
    expect(getRevisionWarnings(target, '労働組合法')).toHaveLength(1);
  });

  it('照合済みでも廃止の警告は出す', () => {
    const repealed = { ...target, repeal_status: 'Repeal', repeal_date: '2026-07-01' };
    const w = getRevisionWarnings(repealed, '某法', { latestEnforcedVerified: true });
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toContain('廃止されています');
  });

  it('PreviousEnforced 以外の非現行状態には効かない', () => {
    const unenforced = { ...target, current_revision_status: 'UnEnforced' };
    expect(getRevisionWarnings(unenforced, '某法', { latestEnforcedVerified: true })).toHaveLength(1);
  });

  it('revision_metadata は生の status を保ち、照合済みのときだけ latest_enforced_verified: true を載せる', () => {
    const verified = buildRevisionMetadata(target, { latestEnforcedVerified: true });
    expect(verified?.current_revision_status).toBe('PreviousEnforced');
    expect(verified?.latest_enforced_verified).toBe(true);
    expect(buildRevisionMetadata(target)?.latest_enforced_verified).toBeUndefined();
    expect(buildRevisionMetadata(target, { latestEnforcedVerified: false })?.latest_enforced_verified).toBeUndefined();
  });
});

describe('get_article: PreviousEnforced タグの照合（e-Gov fetch を stub）', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function stubFetch(revisionInfo: EgovRevisionInfo, revisionsResponder: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/law_revisions/')) return revisionsResponder();
      return json({ ...laborFixture, revision_info: revisionInfo });
    }));
  }
  const revisionsCalls = () =>
    (fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/law_revisions/')).length;

  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('最新の施行版と確認できれば警告せず、revision_metadata に照合結果を載せる', async () => {
    stubFetch(rosoLatest, () => json(rosoRevisions));
    const { createServer } = await import('../src/server.js');
    const env = await callTool<any>(createServer(), 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(false);
    expect(env.data.revision_metadata.current_revision_status).toBe('PreviousEnforced');
    expect(env.data.revision_metadata.latest_enforced_verified).toBe(true);
  });

  it('より新しい施行版があれば警告を残す', async () => {
    const newer = { ...rosoLatest, law_revision_id: '324AC0000000174_20261001_X', amendment_enforcement_date: '2026-10-01' };
    stubFetch(rosoLatest, () => json({ ...rosoRevisions, revisions: [newer, ...rosoRevisions.revisions] }));
    const { createServer } = await import('../src/server.js');
    const env = await callTool<any>(createServer(), 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(true);
    expect(env.data.revision_metadata.latest_enforced_verified).toBeUndefined();
  });

  it('/law_revisions の取得に失敗したら警告を残し、status ok・degraded なし', async () => {
    stubFetch(rosoLatest, () => json({ message: 'unavailable' }, 503));
    const { createServer } = await import('../src/server.js');
    const env = await callTool<any>(createServer(), 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(env.status).toBe('ok');
    expect(env.degraded).toBe(false);
    expect(env.partial_failures).toEqual([]);
    expect(env.warnings.some((w: any) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(true);
  });

  it('CurrentEnforced なら /law_revisions を引かない', async () => {
    stubFetch(laborFixture.revision_info, () => json(rosoRevisions));
    const { createServer } = await import('../src/server.js');
    await callTool<any>(createServer(), 'get_article', { law_id: '322AC0000000049', article: '32' });
    expect(revisionsCalls()).toBe(0);
  });
});
