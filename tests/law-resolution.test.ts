import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLawData } from '../src/lib/egov-client.js';
import { LAW_ID_MAP, isEgovLawId, resolveLawCandidates, resolveLawNameStrict } from '../src/lib/law-registry.js';
import { ValidationError } from '../src/lib/errors.js';

describe('law resolution', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('略称を strict resolve できる', () => {
    expect(resolveLawNameStrict('労基法')).toEqual({
      name: '労働基準法',
      lawId: '322AC0000000049',
    });
  });

  it('部分一致では候補を複数返せる', () => {
    const candidates = resolveLawCandidates('労働');
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.some((candidate) => candidate.lawTitle === '労働基準法')).toBe(true);
  });

  it('未知の法令名は fetch 前に ValidationError で失敗する', async () => {
    await expect(fetchLawData('労働')).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('空の法令名は fetch 前に ValidationError で失敗する', async () => {
    await expect(fetchLawData('   ')).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('isEgovLawId', () => {
    // 法令種別コードは 2 文字目が数字になりうる（省令 M4/M5）。resolve_law が返した law_id を
    // get_article が形式不一致で拒否しないよう、登録済み law_id は全件 law_id 形式と判定されること
    it.each(Object.entries(LAW_ID_MAP))('登録済み %s (%s) を law_id と判定する', (_name, lawId) => {
      expect(isEgovLawId(lawId)).toBe(true);
    });

    it.each(['322M40000100023', '215IO0000000243', '321CONSTITUTION'])(
      '法令種別コードが英字 2 文字でない実在の law_id %s を law_id と判定する',
      (lawId) => {
        expect(isEgovLawId(lawId)).toBe(true);
      }
    );

    it.each(['労働基準法', '322AC000000004', '322AC00000000490', '322ac0000000049', 'AAAAC0000000049'])(
      '%s は law_id と判定しない',
      (input) => {
        expect(isEgovLawId(input)).toBe(false);
      }
    );
  });

  it('省令の law_id は ValidationError にならず e-Gov law_data を取得する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          law_info: { law_id: '322M40000100023' },
          revision_info: { law_title: '労働基準法施行規則' },
          law_full_text: { tag: 'Law', children: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await fetchLawData('322M40000100023');

    expect(result.lawId).toBe('322M40000100023');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/law_data/322M40000100023');
  });
});
