import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/services/law-service.js', () => ({
  getArticleByLawId: vi.fn(),
  verifyLatestEnforced: vi.fn().mockResolvedValue(false),
}));

import { getArticleByLawId } from '../src/lib/services/law-service.js';
import { diffRevision } from '../src/lib/services/diff-revision-service.js';

describe('diffRevision', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('同一条文の差分を chunk 化して返す', async () => {
    vi.mocked(getArticleByLawId)
      .mockResolvedValueOnce({
        lawId: 'base-law',
        lawTitle: '労働基準法',
        lawNum: '昭和二十二年法律第四十九号',
        promulgationDate: '1947-04-07',
        article: '32',
        articleCaption: '労働時間',
        text: '使用者は、労働者に休憩を与える。\nただし、例外を設ける。',
        egovUrl: 'https://laws.e-gov.go.jp/law/base-law',
      })
      .mockResolvedValueOnce({
        lawId: 'head-law',
        lawTitle: '労働基準法',
        lawNum: '令和六年法律第十号',
        promulgationDate: '2024-04-01',
        article: '32',
        articleCaption: '労働時間',
        text: '使用者は、労働者に休憩を与える。\nただし、合理的な例外を設ける。',
        egovUrl: 'https://laws.e-gov.go.jp/law/head-law',
      });

    const result = await diffRevision({
      baseLawId: 'base-law',
      headLawId: 'head-law',
      article: '32',
    });

    expect(result.summary.changed).toBe(true);
    expect(result.summary.deleted_chunks).toBe(1);
    expect(result.summary.inserted_chunks).toBe(1);
    expect(result.diff_chunks).toEqual([
      { type: 'equal', text: '（労働時間）\n使用者は、労働者に休憩を与える。' },
      { type: 'delete', text: 'ただし、例外を設ける。' },
      { type: 'insert', text: 'ただし、合理的な例外を設ける。' },
    ]);
  });

  it('法令名が異なる場合は validation error を返す', async () => {
    vi.mocked(getArticleByLawId)
      .mockResolvedValueOnce({
        lawId: 'base-law',
        lawTitle: '労働基準法',
        lawNum: '昭和二十二年法律第四十九号',
        promulgationDate: '1947-04-07',
        article: '32',
        articleCaption: '',
        text: '使用者は...',
        egovUrl: 'https://laws.e-gov.go.jp/law/base-law',
      })
      .mockResolvedValueOnce({
        lawId: 'head-law',
        lawTitle: '労働安全衛生法',
        lawNum: '昭和四十七年法律第五十七号',
        promulgationDate: '1972-06-08',
        article: '32',
        articleCaption: '',
        text: '事業者は...',
        egovUrl: 'https://laws.e-gov.go.jp/law/head-law',
      });

    await expect(diffRevision({
      baseLawId: 'base-law',
      headLawId: 'head-law',
      article: '32',
    })).rejects.toThrow('同一法令の改正前後比較のみ対応');
  });

  it('題名が改正で変わっていても、law_id が同じなら同じ法令として比べる', async () => {
    const article = {
      lawId: '403AC0000000076', lawNum: '平成三年法律第七十六号', promulgationDate: '1991-05-15',
      article: '1', articleCaption: '', text: '目的', egovUrl: 'https://laws.e-gov.go.jp/law/403AC0000000076',
    };
    vi.mocked(getArticleByLawId)
      .mockResolvedValueOnce({ ...article, lawTitle: '育児休業等に関する法律' })
      .mockResolvedValueOnce({ ...article, lawTitle: '育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律' });
    const result = await diffRevision({ baseLawId: '403AC0000000076_19920401_000000000000000', headLawId: '403AC0000000076', article: '1' });
    expect(result.status).toBe('ok');
  });

  it('paragraph を省いた号が改正前後で別の項に解決されたら DIFF_PARAGRAPH_MISMATCH を出し、canonical_id に各々の項を含める', async () => {
    const base = {
      lawTitle: '労働基準法施行規則', lawNum: '昭和二十二年厚生省令第二十三号', promulgationDate: '1947-08-30',
      article: '5', articleCaption: '', captionInText: false, text: '二 …',
    };
    vi.mocked(getArticleByLawId)
      .mockResolvedValueOnce({ ...base, lawId: 'base-law', egovUrl: 'https://laws.e-gov.go.jp/law/base-law', paragraph: 1 } as any)
      .mockResolvedValueOnce({ ...base, lawId: 'head-law', egovUrl: 'https://laws.e-gov.go.jp/law/head-law', paragraph: 2 } as any);

    const result = await diffRevision({ baseLawId: 'base-law', headLawId: 'head-law', article: '5', item: 2 });

    expect(result.base_evidence.canonical_id).toBe('egov:base-law:article:5:paragraph:1:item:2');
    expect(result.head_evidence.canonical_id).toBe('egov:head-law:article:5:paragraph:2:item:2');
    expect(result.base_evidence.paragraph).toBe(1);
    expect(result.head_evidence.paragraph).toBe(2);
    expect(result.warnings.map((w) => w.code)).toContain('DIFF_PARAGRAPH_MISMATCH');
  });

  it('改正前後で同じ項なら警告しない', async () => {
    const base = {
      lawTitle: '労働基準法施行規則', lawNum: '昭和二十二年厚生省令第二十三号', promulgationDate: '1947-08-30',
      article: '5', articleCaption: '', captionInText: false, text: '二 …', paragraph: 1,
    };
    vi.mocked(getArticleByLawId)
      .mockResolvedValueOnce({ ...base, lawId: 'base-law', egovUrl: 'https://laws.e-gov.go.jp/law/base-law' } as any)
      .mockResolvedValueOnce({ ...base, lawId: 'head-law', egovUrl: 'https://laws.e-gov.go.jp/law/head-law' } as any);

    const result = await diffRevision({ baseLawId: 'base-law', headLawId: 'head-law', article: '5', item: 2 });
    expect(result.warnings).toEqual([]);
  });
});

