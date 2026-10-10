import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/egov-client.js', () => ({
  fetchLawData: vi.fn(),
  searchLaws: vi.fn(),
  getEgovUrl: (lawId: string) => `https://laws.e-gov.go.jp/law/${lawId}`,
}));

import { searchLaws } from '../src/lib/egov-client.js';
import { resolveLaw, searchLaw } from '../src/lib/services/law-service.js';

describe('resolveLaw service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registry にない正式名称を e-Gov の厳密一致で補完できる', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      {
        law_info: {
          law_id: '999AC0000000001',
          law_type: 'Act',
          law_num: '令和六年法律第一号',
          promulgation_date: '2024-01-01',
        },
        revision_info: {
          law_title: '架空労働支援法',
          abbrev: '架空法',
        },
      },
    ]);

    const result = await resolveLaw({ query: '架空労働支援法' });

    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0]?.lawId).toBe('999AC0000000001');
    expect(result.warnings[0]?.code).toBe('UPSTREAM_EXACT_MATCH');
    expect(result.usedIndex).toBe(false);
  });

  it('既知法令は内部索引で解決し upstream を呼ばない', async () => {
    const result = await resolveLaw({ query: '労働基準法' });

    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0]?.lawId).toBe('322AC0000000049');
    expect(result.usedIndex).toBe(true);
    expect(searchLaws).not.toHaveBeenCalled();
  });
});

describe('廃止された法令の候補', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const hit = (lawId: string, lawNum: string, repeal?: { repeal_status: string; repeal_date: string }) => ({
    law_info: { law_id: lawId, law_type: 'Act', law_num: lawNum, promulgation_date: '2000-01-01' },
    revision_info: { law_title: '架空学術会議法', ...(repeal ?? { repeal_status: 'None' }) },
    current_revision_info: { law_title: '架空学術会議法', ...(repeal ?? { repeal_status: 'None' }) },
  });

  it('同じ題名の廃止された法令と現行の法令があれば、現行の法令に解決し、廃止された法令を後ろに残して知らせる', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      hit('323AC0000000999', '昭和二十三年法律第九百九十九号', { repeal_status: 'Repeal', repeal_date: '2026-10-01' }),
      hit('507AC0000000999', '令和七年法律第九百九十九号'),
    ]);
    const result = await resolveLaw({ query: '架空学術会議法' });
    expect(result.resolution).toBe('resolved');
    expect(result.candidates.map((c) => [c.lawId, c.repealStatus, c.repealDate])).toEqual([
      ['507AC0000000999', undefined, undefined],
      ['323AC0000000999', 'Repeal', '2026-10-01'],
    ]);
    const warning = result.warnings.find((w) => w.code === 'REPEALED_LAW_CANDIDATE');
    expect(warning?.message).toContain('323AC0000000999');
    expect(warning?.message).toContain('2026-10-01（令和8年10月1日）');
  });

  it('廃止された法令しか無ければ、解決の判定は変えずに知らせる', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      hit('323AC0000000999', '昭和二十三年法律第九百九十九号', { repeal_status: 'Repeal', repeal_date: '2026-10-01' }),
    ]);
    const result = await resolveLaw({ query: '架空学術会議法' });
    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0].repealStatus).toBe('Repeal');
    expect(result.warnings.map((w) => w.code)).toContain('REPEALED_LAW_CANDIDATE');
  });

  it('現行の法令が複数なら従来どおり ambiguous', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      hit('507AC0000000998', '令和七年法律第九百九十八号'),
      hit('507AC0000000999', '令和七年法律第九百九十九号'),
    ]);
    const result = await resolveLaw({ query: '架空学術会議法' });
    expect(result.resolution).toBe('ambiguous');
    expect(result.warnings.map((w) => w.code)).not.toContain('REPEALED_LAW_CANDIDATE');
  });

  it('search_law の upstream 検索の結果にも廃止の状態を載せ、警告する', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      hit('323AC0000000999', '昭和二十三年法律第九百九十九号', { repeal_status: 'Repeal', repeal_date: '2026-10-01' }),
      hit('507AC0000000999', '令和七年法律第九百九十九号'),
    ]);
    const result = await searchLaw({ keyword: '架空学術会議' });
    expect(result.usedIndex).toBe(false);
    expect(result.results.map((r) => [r.lawId, r.repealStatus, r.repealDate])).toEqual([
      ['323AC0000000999', 'Repeal', '2026-10-01'],
      ['507AC0000000999', undefined, undefined],
    ]);
    expect(result.warnings.map((w) => w.code)).toContain('REPEALED_LAW_IN_RESULTS');
  });
});
