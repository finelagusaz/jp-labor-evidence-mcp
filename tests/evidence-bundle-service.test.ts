import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalApiError } from '../src/lib/errors.js';

vi.mock('../src/lib/services/law-service.js', () => ({
  getArticleByLawId: vi.fn(),
  getLawToc: vi.fn(),
  findRelatedSources: vi.fn(),
}));

vi.mock('../src/lib/services/mhlw-tsutatsu-service.js', () => ({
  searchMhlwTsutatsu: vi.fn(),
}));

vi.mock('../src/lib/services/jaish-tsutatsu-service.js', () => ({
  searchJaishTsutatsu: vi.fn(),
}));

import { findRelatedSources, getArticleByLawId, getLawToc } from '../src/lib/services/law-service.js';
import { searchMhlwTsutatsu } from '../src/lib/services/mhlw-tsutatsu-service.js';
import { searchJaishTsutatsu } from '../src/lib/services/jaish-tsutatsu-service.js';
import { getEvidenceBundle } from '../src/lib/services/evidence-bundle-service.js';

describe('getEvidenceBundle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('主条文と関連通達候補を束ねる', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号',
      promulgationDate: '1947-04-07',
      article: '32',
      articleCaption: '労働時間',
      text: '使用者は、労働者に...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      delegatedLaws: [{
        lawId: '322CO0000000300',
        lawTitle: '労働基準法施行令',
        lawType: 'CabinetOrder',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322CO0000000300',
        aliases: ['労基令'],
      }],
      searchKeywords: ['労働時間'],
      warnings: [],
    });
    vi.mocked(getLawToc).mockResolvedValue({
      lawId: '322CO0000000300',
      lawTitle: '労働基準法施行令',
      lawNum: '昭和二十二年政令第三百号',
      promulgationDate: '1947-08-30',
      toc: '第一章 総則',
      egovUrl: 'https://laws.e-gov.go.jp/law/322CO0000000300',
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [{
        title: '労働時間の適正把握について',
        dataId: '00tb2035',
        date: '2024-01-01',
        shubetsu: '基発0101第1号',
      }],
      totalCount: 1,
      page: 0,
      partialFailures: [],
      warnings: [],
    });
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [],
      pagesSearched: 1,
      failedPages: [],
      warnings: [],
    });

    const result = await getEvidenceBundle({
      lawId: '322AC0000000049',
      article: '32',
      relatedKeywords: ['労働時間'],
    });

    expect(result.status).toBe('ok');
    expect(result.primary_evidence.canonical_id).toBe('egov:322AC0000000049:article:32');
    expect(result.delegated_evidence[0]?.canonical_id).toBe('egov:322CO0000000300:toc');
    expect(result.related_tsutatsu[0]?.canonical_id).toBe('mhlw:00tb2035');
    expect(result.delegated_evidence).toHaveLength(1);
    expect(result.related_tsutatsu[0]?.matched_keywords).toContain('労働時間');
    expect(result.related_tsutatsu[0]?.matched_signals?.map((signal) => signal.type)).toEqual(
      expect.arrayContaining(['source_priority', 'heading', 'body_keyword'])
    );
    expect(result.related_tsutatsu[0]?.relevance_score).toBeGreaterThan(0.4);
    expect(result.related_tsutatsu[0]?.relevance_reason).toContain('見出し一致');
  });

  it('partial failure があれば partial を返す', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      lawNum: '昭和四十七年法律第五十七号',
      promulgationDate: '1972-06-08',
      article: '59',
      articleCaption: '安全衛生教育',
      text: '事業者は...',
      egovUrl: 'https://laws.e-gov.go.jp/law/347AC0000000057',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      delegatedLaws: [],
      searchKeywords: ['足場'],
      warnings: [{ code: 'NO_DELEGATED_LAWS_CONFIGURED', message: '未登録' }],
    });
    vi.mocked(getLawToc).mockResolvedValue({
      lawId: '347CO0000000318',
      lawTitle: '労働安全衛生法施行令',
      lawNum: '昭和四十七年政令第三百十八号',
      promulgationDate: '1972-08-19',
      toc: '第一章',
      egovUrl: 'https://laws.e-gov.go.jp/law/347CO0000000318',
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'unavailable',
      results: [],
      totalCount: 0,
      page: 0,
      partialFailures: [{ source: 'mhlw', target: 'page:0', reason: 'timeout' }],
      warnings: [{ code: 'MHLW_SEARCH_UNAVAILABLE', message: '取得失敗' }],
    });
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'partial',
      results: [{
        title: '足場の安全基準について',
        number: '基安発0106第3号',
        date: '2026-01-06',
        url: '/anzen/example.htm',
      }],
      pagesSearched: 1,
      failedPages: [{ source: 'jaish', target: '/index', reason: 'timeout' }],
      warnings: [{ code: 'JAISH_SEARCH_PARTIAL', message: '一部失敗' }],
    });

    const result = await getEvidenceBundle({
      lawId: '347AC0000000057',
      article: '59',
      relatedKeywords: ['足場'],
    });

    expect(result.status).toBe('partial');
    expect(result.partial_failures).toHaveLength(2);
    expect(result.warnings[0]?.code).toBe('NO_DELEGATED_LAWS_CONFIGURED');
    expect(result.related_tsutatsu[0]?.canonical_id).toBe('jaish:/anzen/example.htm');
    expect(result.related_tsutatsu[0]?.relevance_reason).toContain('本文語一致');
  });

  it('明示キーワードがなければ本文から補助キーワードを生成する', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      lawNum: '昭和四十七年法律第五十七号',
      promulgationDate: '1972-06-08',
      article: '59',
      articleCaption: '',
      text: '事業者は、危険防止のため、安全教育を行わなければならない。',
      egovUrl: 'https://laws.e-gov.go.jp/law/347AC0000000057',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      delegatedLaws: [],
      searchKeywords: ['労働安全衛生法 59'],
      warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [],
      totalCount: 0,
      page: 0,
      partialFailures: [],
      warnings: [],
    });
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [],
      pagesSearched: 1,
      failedPages: [],
      warnings: [],
    });

    const result = await getEvidenceBundle({
      lawId: '347AC0000000057',
      article: '59',
    });

    expect(result.search_keywords).toContain('危険防止');
    expect(result.search_keywords).toContain('安全教育');
  });

  it('一致信号が多い候補を上位に返す', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号',
      promulgationDate: '1947-04-07',
      article: '32',
      articleCaption: '労働時間',
      text: '使用者は、労働者に...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      delegatedLaws: [],
      searchKeywords: ['労働時間'],
      warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [{
        title: '労働基準法第32条の運用について',
        dataId: '00tb2036',
        date: '2024-02-01',
        shubetsu: '基発0201第1号',
      }],
      totalCount: 1,
      page: 0,
      partialFailures: [],
      warnings: [],
    });
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [{
        title: '労働時間管理の参考資料',
        number: '基安発0201第2号',
        date: '2024-02-01',
        url: '/anzen/example-2.htm',
      }],
      pagesSearched: 1,
      failedPages: [],
      warnings: [],
    });

    const result = await getEvidenceBundle({
      lawId: '322AC0000000049',
      article: '32',
      relatedKeywords: ['労働時間'],
    });

    expect(result.related_tsutatsu[0]?.canonical_id).toBe('mhlw:00tb2036');
    expect(result.related_tsutatsu[0]?.matched_signals?.map((signal) => signal.type)).toEqual(
      expect.arrayContaining(['law_title', 'article_ref', 'source_priority'])
    );
    expect(result.related_tsutatsu[0]?.relevance_score).toBeGreaterThan(
      result.related_tsutatsu[1]?.relevance_score ?? 0
    );
  });

  it('関連探索が例外でも主条文を返し partial に落とす', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号',
      promulgationDate: '1947-04-07',
      article: '32',
      articleCaption: '労働時間',
      text: '使用者は、労働者に...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      delegatedLaws: [{
        lawId: '322CO0000000300',
        lawTitle: '労働基準法施行令',
        lawType: 'CabinetOrder',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322CO0000000300',
        aliases: ['労基令'],
      }],
      searchKeywords: ['労働時間'],
      warnings: [],
    });
    vi.mocked(getLawToc).mockRejectedValue(new ExternalApiError('toc timeout'));
    vi.mocked(searchMhlwTsutatsu).mockRejectedValue(new ExternalApiError('mhlw timeout'));
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok',
      results: [],
      pagesSearched: 1,
      failedPages: [],
      warnings: [],
    });

    const result = await getEvidenceBundle({
      lawId: '322AC0000000049',
      article: '32',
    });

    expect(result.status).toBe('partial');
    expect(result.primary_evidence.canonical_id).toBe('egov:322AC0000000049:article:32');
    expect(result.delegated_evidence).toHaveLength(0);
    expect(result.partial_failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'egov', target: 'toc:322CO0000000300', reason: 'upstream_unavailable' }),
        expect.objectContaining({ source: 'mhlw', target: 'search:労働時間', reason: 'upstream_unavailable' }),
      ])
    );
  });
});
