import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/services/law-service.js', () => ({
  getArticleByLawId: vi.fn(),
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
});
