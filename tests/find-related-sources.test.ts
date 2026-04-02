import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/egov-client.js', () => ({
  fetchLawData: vi.fn(),
  searchLaws: vi.fn(),
  getEgovUrl: (lawId: string) => `https://laws.e-gov.go.jp/law/${lawId}`,
}));

import { fetchLawData } from '../src/lib/egov-client.js';
import { findRelatedSources } from '../src/lib/services/law-service.js';

describe('findRelatedSources', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('既知法令から委任先法令候補を返す', async () => {
    vi.mocked(fetchLawData).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      data: {
        law_info: {
          law_id: '322AC0000000049',
          law_type: 'Act',
          law_num: '昭和二十二年法律第四十九号',
          promulgation_date: '1947-04-07',
        },
        law_full_text: { tag: 'Law', children: [] },
      },
    });

    const result = await findRelatedSources({
      lawId: '322AC0000000049',
      article: '32',
      articleCaption: '労働時間',
    });

    expect(result.delegatedLaws.map((law) => law.lawTitle)).toEqual([
      '労働基準法施行規則',
      '労働基準法施行令',
    ]);
    expect(result.searchKeywords).toContain('労働時間');
  });

  it('徴収法グループの関連法令候補を返す', async () => {
    vi.mocked(fetchLawData).mockResolvedValue({
      lawId: '344AC0000000084',
      lawTitle: '労働保険の保険料の徴収等に関する法律',
      data: {
        law_info: {
          law_id: '344AC0000000084',
          law_type: 'Act',
          law_num: '昭和四十四年法律第八十四号',
          promulgation_date: '1969-12-09',
        },
        law_full_text: { tag: 'Law', children: [] },
      },
    });

    const result = await findRelatedSources({
      lawId: '344AC0000000084',
    });

    expect(result.delegatedLaws.map((law) => law.lawTitle)).toEqual([
      '雇用保険法',
      '労働者災害補償保険法',
    ]);
  });

  it('労基法36条では実務用語を検索キーワードに補完する', async () => {
    vi.mocked(fetchLawData).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      data: {
        law_info: {
          law_id: '322AC0000000049',
          law_type: 'Act',
          law_num: '昭和二十二年法律第四十九号',
          promulgation_date: '1947-04-07',
        },
        law_full_text: { tag: 'Law', children: [] },
      },
    });

    const result = await findRelatedSources({
      lawId: '322AC0000000049',
      article: '36',
      articleCaption: '時間外及び休日の労働',
    });

    expect(result.searchKeywords).toEqual(expect.arrayContaining([
      '36協定',
      '時間外労働',
      '休日労働',
      '労基法 第36条',
      '労働基準法 第36条',
    ]));
  });
});
