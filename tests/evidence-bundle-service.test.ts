import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalApiError } from '../src/lib/errors.js';

vi.mock('../src/lib/services/law-service.js', () => ({
  getArticleByLawId: vi.fn(),
  getLawToc: vi.fn(),
  findRelatedSources: vi.fn(),
  verifyLatestEnforced: vi.fn().mockResolvedValue(false),
  findAmendmentLawTitle: vi.fn(),
  getPendingAmendments: vi.fn(),
}));

vi.mock('../src/lib/services/mhlw-tsutatsu-service.js', () => ({
  searchMhlwTsutatsu: vi.fn(),
}));

vi.mock('../src/lib/services/jaish-tsutatsu-service.js', () => ({
  searchJaishTsutatsu: vi.fn(),
}));

import { findAmendmentLawTitle, findRelatedSources, getArticleByLawId, getLawToc, getPendingAmendments, verifyLatestEnforced } from '../src/lib/services/law-service.js';
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
        lawId: '322M40000100023',
        lawTitle: '労働基準法施行規則',
        lawType: 'MinisterialOrdinance',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322M40000100023',
        aliases: ['労基則'],
      }],
      searchKeywords: ['労働時間'],
      warnings: [],
    });
    vi.mocked(getLawToc).mockResolvedValue({
      lawId: '322M40000100023',
      lawTitle: '労働基準法施行規則',
      lawNum: '昭和二十二年厚生省令第二十三号',
      promulgationDate: '1947-08-30',
      toc: '第一章 総則',
      egovUrl: 'https://laws.e-gov.go.jp/law/322M40000100023',
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
    expect(result.delegated_evidence[0]?.canonical_id).toBe('egov:322M40000100023:toc');
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

  it('労基法36条では実務用語を関連検索キーワードに補完する', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号',
      promulgationDate: '1947-04-07',
      article: '36',
      articleCaption: '時間外及び休日の労働',
      text: '使用者は、協定をし、これを行政官庁に届け出た場合においては...',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      delegatedLaws: [],
      searchKeywords: ['36協定', '時間外労働', '休日労働', '労基法 第36条'],
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
      lawId: '322AC0000000049',
      article: '36',
    });

    expect(result.search_keywords).toContain('36協定');
    expect(result.search_keywords).toContain('時間外労働');
    expect(result.search_keywords).toContain('休日労働');
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
    expect(result.related_tsutatsu.map((item) => item.canonical_id)).toEqual([
      'mhlw:00tb2036',
      'jaish:/anzen/example-2.htm',
    ]);
  });

  it('同一候補が複数キーワードでヒットしても順位が安定する', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      lawNum: '昭和四十七年法律第五十七号',
      promulgationDate: '1972-06-08',
      article: '59',
      articleCaption: '安全衛生教育',
      text: '事業者は、安全教育及び危険防止のため必要な措置を講ずる。',
      egovUrl: 'https://laws.e-gov.go.jp/law/347AC0000000057',
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '347AC0000000057',
      lawTitle: '労働安全衛生法',
      delegatedLaws: [],
      searchKeywords: ['安全教育', '危険防止'],
      warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu)
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{
          title: '安全教育の実施について',
          dataId: '00tb3001',
          date: '2024-03-01',
          shubetsu: '基発0301第1号',
        }],
        totalCount: 1,
        page: 0,
        partialFailures: [],
        warnings: [],
        route: 'upstream_fallback',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{
          title: '安全教育の実施について',
          dataId: '00tb3001',
          date: '2024-03-01',
          shubetsu: '基発0301第1号',
        }],
        totalCount: 1,
        page: 0,
        partialFailures: [],
        warnings: [],
        route: 'upstream_fallback',
      });
    vi.mocked(searchJaishTsutatsu)
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{
          title: '危険防止措置の参考資料',
          number: '基安発0301第2号',
          date: '2024-03-01',
          url: '/anzen/example-3.htm',
        }],
        pagesSearched: 1,
        failedPages: [],
        warnings: [],
        route: 'upstream_fallback',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        results: [{
          title: '危険防止措置の参考資料',
          number: '基安発0301第2号',
          date: '2024-03-01',
          url: '/anzen/example-3.htm',
        }],
        pagesSearched: 1,
        failedPages: [],
        warnings: [],
        route: 'upstream_fallback',
      });

    const result = await getEvidenceBundle({
      lawId: '347AC0000000057',
      article: '59',
      relatedKeywords: ['安全教育', '危険防止'],
    });

    expect(result.related_tsutatsu).toHaveLength(2);
    expect(result.related_tsutatsu.map((item) => item.canonical_id)).toEqual([
      'mhlw:00tb3001',
      'jaish:/anzen/example-3.htm',
    ]);
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
        lawId: '322M40000100023',
        lawTitle: '労働基準法施行規則',
        lawType: 'MinisterialOrdinance',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322M40000100023',
        aliases: ['労基則'],
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
        expect.objectContaining({ source: 'egov', target: 'toc:322M40000100023', reason: 'upstream_unavailable' }),
        expect.objectContaining({ source: 'mhlw', target: 'search:労働時間', reason: 'upstream_unavailable' }),
      ])
    );
  });

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

  it('PreviousEnforced でも照合で最新の施行版なら、主条文・委任先とも警告せず照合結果を載せる', async () => {
    const staleTag = {
      law_revision_id: '324AC0000000174_20260624_508AC0000000046',
      amendment_enforcement_date: '2026-06-24',
      current_revision_status: 'PreviousEnforced', repeal_status: 'None',
    };
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '324AC0000000174', lawTitle: '労働組合法',
      lawNum: '昭和二十四年法律第百七十四号', promulgationDate: '1949-06-01',
      article: '1', articleCaption: '', text: '...',
      egovUrl: 'https://laws.e-gov.go.jp/law/324AC0000000174',
      revisionInfo: staleTag,
    });
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '324AC0000000174', lawTitle: '労働組合法',
      delegatedLaws: [{ lawId: '324CO0000000231', lawTitle: '労働組合法施行令' }],
      searchKeywords: [], warnings: [],
    } as any);
    vi.mocked(getLawToc).mockResolvedValue({
      lawId: '324CO0000000231', lawTitle: '労働組合法施行令', toc: '目次',
      egovUrl: 'https://laws.e-gov.go.jp/law/324CO0000000231',
      revisionInfo: { ...staleTag, law_revision_id: '324CO0000000231_20260624_X' },
    } as any);
    vi.mocked(verifyLatestEnforced).mockResolvedValue(true);
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({ results: [], warnings: [], failedPages: [] } as any);

    const bundle = await getEvidenceBundle({ lawId: '324AC0000000174', article: '1', includeJaish: false });
    expect(vi.mocked(verifyLatestEnforced)).toHaveBeenCalledWith('324AC0000000174', staleTag);
    expect(vi.mocked(verifyLatestEnforced)).toHaveBeenCalledWith('324CO0000000231', expect.objectContaining({ current_revision_status: 'PreviousEnforced' }));
    expect(bundle.warnings.some((w) => w.code === 'LAW_NOT_CURRENTLY_ENFORCED')).toBe(false);
    expect(bundle.primary_evidence.revision_metadata?.latest_enforced_verified).toBe(true);
    expect(bundle.delegated_evidence?.[0]?.revision_metadata?.latest_enforced_verified).toBe(true);
  });

  describe('附則・号・細分', () => {
    const supplPrimary = {
      lawId: '322AC0000000049', lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号', promulgationDate: '1947-04-07',
      article: '1', articleCaption: '施行期日', captionInText: true,
      text: '#### （施行期日）\n**第一条**\n\nこの法律は、令和九年四月一日から施行する。',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      supplementary: { key: '令和8年法律第60号', amendLawNum: '令和八年七月一七日法律第六〇号', extract: true },
    };
    const stubRelated = () => {
      vi.mocked(findRelatedSources).mockResolvedValue({
        lawId: '322AC0000000049', lawTitle: '労働基準法', delegatedLaws: [], searchKeywords: ['労基法', '労働基準法'], warnings: [],
      });
      vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);
    };

    it('改正附則: 条番号・条見出しを検索に使わず、改正法の題名を先頭のキーワードにする', async () => {
      vi.mocked(getArticleByLawId).mockResolvedValue(supplPrimary as any);
      vi.mocked(findAmendmentLawTitle).mockResolvedValue('労働基準法等の一部を改正する法律');
      stubRelated();

      const bundle = await getEvidenceBundle({ lawId: '322AC0000000049', supplementary: '令和八年法律第六十号', article: '1', includeJaish: false });

      expect(vi.mocked(getArticleByLawId)).toHaveBeenCalledWith(expect.objectContaining({ supplementary: '令和八年法律第六十号', article: '1' }));
      expect(vi.mocked(findRelatedSources)).toHaveBeenCalledWith({ lawId: '322AC0000000049', article: undefined, articleCaption: undefined });
      expect(vi.mocked(findAmendmentLawTitle)).toHaveBeenCalledWith('322AC0000000049', '令和8年法律第60号');
      expect(bundle.search_keywords[0]).toBe('労働基準法等の一部を改正する法律');
      expect(bundle.search_keywords).not.toContain('施行期日');
      expect(bundle.primary_evidence.title).toBe('労働基準法 附則（令和8年法律第60号・抄）第1条');
      expect(bundle.primary_evidence.canonical_id).toBe('egov:322AC0000000049:suppl:令和8年法律第60号:article:1');
      expect(bundle.primary_evidence.article_locator).toEqual({ law_id: '322AC0000000049', supplementary: '令和8年法律第60号', article: '1' });
      expect(bundle.primary_evidence.body?.startsWith('#### （施行期日）')).toBe(true);
    });

    it('制定時附則: 改正法の題名は引かず、本文の「施行期日」もキーワードにしない', async () => {
      vi.mocked(getArticleByLawId).mockResolvedValue({ ...supplPrimary, supplementary: { key: '制定', extract: true } } as any);
      vi.mocked(findRelatedSources).mockResolvedValue({
        lawId: '322AC0000000049', lawTitle: '労働基準法', delegatedLaws: [], searchKeywords: [], warnings: [],
      });
      vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);

      const bundle = await getEvidenceBundle({ lawId: '322AC0000000049', supplementary: '制定', article: '1', includeJaish: false });

      expect(vi.mocked(findAmendmentLawTitle)).not.toHaveBeenCalled();
      expect(bundle.search_keywords).not.toContain('施行期日');
      // 本文の条名の行（**第一条**）は本則の同じ番号の条を指してしまうので拾わない
      expect(bundle.search_keywords.some((k) => /^第.+条$/.test(k))).toBe(false);
    });

    it('改正法の題名の取得に失敗したら partial_failures に記録して続ける', async () => {
      vi.mocked(getArticleByLawId).mockResolvedValue(supplPrimary as any);
      vi.mocked(findAmendmentLawTitle).mockRejectedValue(new ExternalApiError('law_revisions HTTP 503'));
      stubRelated();

      const bundle = await getEvidenceBundle({ lawId: '322AC0000000049', supplementary: '令和8年法律第60号', article: '1', includeJaish: false });

      expect(bundle.status).toBe('partial');
      expect(bundle.partial_failures.some((f) => f.target === 'law_revisions:322AC0000000049')).toBe(true);
      expect(bundle.primary_evidence.canonical_id).toBe('egov:322AC0000000049:suppl:令和8年法律第60号:article:1');
    });

    it('paragraph を省いた号: canonical_id と article_locator に特定した項を含め、号は正規形', async () => {
      vi.mocked(getArticleByLawId).mockResolvedValue({
        lawId: '322M40000100023', lawTitle: '労働基準法施行規則',
        lawNum: '昭和二十二年厚生省令第二十三号', promulgationDate: '1947-08-30',
        article: '7の2', articleCaption: '', captionInText: false, text: '（ｉｉｉ） …',
        egovUrl: 'https://laws.e-gov.go.jp/law/322M40000100023',
        paragraph: 1, subitem: 'ロ/1/iii',
      } as any);
      vi.mocked(findRelatedSources).mockResolvedValue({
        lawId: '322M40000100023', lawTitle: '労働基準法施行規則', delegatedLaws: [], searchKeywords: [], warnings: [],
      });
      vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);

      const bundle = await getEvidenceBundle({ lawId: '322M40000100023', article: '7の2', item: '二', subitem: 'ロ (1) (iii)', includeJaish: false });

      expect(bundle.primary_evidence.canonical_id).toBe('egov:322M40000100023:article:7の2:paragraph:1:item:2:subitem:ロ/1/iii');
      expect(bundle.primary_evidence.title).toBe('労働基準法施行規則 第7条の2第1項第2号ロ（1）（iii）');
      expect(bundle.primary_evidence.article_locator).toEqual({
        law_id: '322M40000100023', article: '7の2', paragraph: 1, item: '二', subitem: 'ロ/1/iii',
      });
      expect(vi.mocked(findRelatedSources)).toHaveBeenCalledWith(expect.objectContaining({ article: '7の2' }));
    });
  });

  it('見出しの無い条は、共通見出しを関連通達の検索と順位づけに使い、primary_evidence に載せる', async () => {
    vi.mocked(getArticleByLawId).mockResolvedValue({
      lawId: '322AC0000000049', lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号', promulgationDate: '1947-04-07',
      article: '32の2', articleCaption: '', captionInText: false, text: '**第三十二条の二**\n\n使用者は、…',
      egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      commonCaption: { caption: '労働時間', fromArticle: '32' },
    } as any);
    vi.mocked(findRelatedSources).mockResolvedValue({
      lawId: '322AC0000000049', lawTitle: '労働基準法', delegatedLaws: [], searchKeywords: ['労働時間'], warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({ results: [], warnings: [], partialFailures: [] } as any);

    const bundle = await getEvidenceBundle({ lawId: '322AC0000000049', article: '32の2', includeJaish: false });

    expect(vi.mocked(findRelatedSources)).toHaveBeenCalledWith({ lawId: '322AC0000000049', article: '32の2', articleCaption: '労働時間' });
    expect(bundle.primary_evidence.common_caption).toEqual({ caption: '労働時間', from_article: '32' });
  });

  describe('通達の順位づけでの条番号の照合', () => {
    const scoreFor = async (article: string, tsutatsuTitle: string) => {
      vi.mocked(getArticleByLawId).mockResolvedValue({
        lawId: '322AC0000000049', lawTitle: '労働基準法',
        lawNum: '昭和二十二年法律第四十九号', promulgationDate: '1947-04-07',
        article, articleCaption: '', captionInText: false, text: '…',
        egovUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      } as any);
      vi.mocked(findRelatedSources).mockResolvedValue({
        lawId: '322AC0000000049', lawTitle: '労働基準法', delegatedLaws: [], searchKeywords: ['労働時間'], warnings: [],
      });
      vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
        status: 'ok', results: [{ title: tsutatsuTitle, dataId: 'x1', date: '', shubetsu: '' }],
        totalCount: 1, page: 0, partialFailures: [], warnings: [],
      } as any);
      const bundle = await getEvidenceBundle({ lawId: '322AC0000000049', article, includeJaish: false });
      return bundle.related_tsutatsu[0]?.matched_signals?.filter((s) => s.type === 'article_ref') ?? [];
    };

    it('枝番号の条は、通達の漢数字の書き方（第三十二条の二）で当たる', async () => {
      expect(await scoreFor('32の2', '労働基準法第三十二条の二の運用について')).toHaveLength(1);
    });

    it('算用数字の書き方（第32条の2）でも当たる', async () => {
      expect(await scoreFor('32の2', '労働基準法第32条の2に関する解釈')).toHaveLength(1);
    });

    it('全角数字の書き方（第３２条の２）でも当たる', async () => {
      expect(await scoreFor('32の2', '労働基準法第３２条の２の適用について')).toHaveLength(1);
    });

    it('数字だけ（昭和32年）には当たらない', async () => {
      expect(await scoreFor('32', '昭和32年の労働基準法の改正について')).toHaveLength(0);
    });
  });
});

describe('getEvidenceBundle: 未施行の改正', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyLatestEnforced).mockResolvedValue(false);
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
      lawId: '322AC0000000049', lawTitle: '労働基準法', delegatedLaws: [], searchKeywords: ['労働時間'], warnings: [],
    });
    vi.mocked(searchMhlwTsutatsu).mockResolvedValue({
      status: 'ok', results: [], totalCount: 0, page: 0, partialFailures: [], warnings: [],
    });
    vi.mocked(searchJaishTsutatsu).mockResolvedValue({
      status: 'ok', results: [], pagesSearched: 1, failedPages: [], warnings: [],
    });
  });

  it('既定では確認しない（pending_amendments を載せず、追加の取得もしない）', async () => {
    const result = await getEvidenceBundle({ lawId: '322AC0000000049', article: '32' });
    expect(getPendingAmendments).not.toHaveBeenCalled();
    expect(result.primary_evidence.pending_amendments).toBeUndefined();
    expect(result.warnings.some((w) => w.code === 'UNENFORCED_AMENDMENT_PENDING')).toBe(false);
  });

  it('includePendingAmendments: 主法令の未施行の改正を primary_evidence に載せ、警告を出す', async () => {
    vi.mocked(getPendingAmendments).mockResolvedValue({
      amendments: [
        { enforcement_date: '2027-04-01', enforcement_date_wareki: '令和9年4月1日', amendment_law_num: '令和七年法律第三十三号' },
        { enforcement_date: '2028-12-23', enforcement_date_wareki: '令和10年12月23日', amendment_law_num: '令和八年法律第四十六号' },
      ],
      excludedCount: 0,
    });
    const result = await getEvidenceBundle({ lawId: '322AC0000000049', article: '32', includePendingAmendments: true });
    expect(getPendingAmendments).toHaveBeenCalledWith('322AC0000000049');
    expect(result.status).toBe('ok');
    expect(result.primary_evidence.pending_amendments?.map((a) => a.enforcement_date)).toEqual(['2027-04-01', '2028-12-23']);
    const warning = result.warnings.find((w) => w.code === 'UNENFORCED_AMENDMENT_PENDING');
    expect(warning?.message).toContain('労働基準法: ');
    expect(warning?.message).toContain('未施行の改正が 2 件');
  });

  it('includePendingAmendments: 未施行の改正が無ければ空配列で、警告は出さない', async () => {
    vi.mocked(getPendingAmendments).mockResolvedValue({ amendments: [], excludedCount: 0 });
    const result = await getEvidenceBundle({ lawId: '322AC0000000049', article: '32', includePendingAmendments: true });
    expect(result.status).toBe('ok');
    expect(result.primary_evidence.pending_amendments).toEqual([]);
    expect(result.warnings.some((w) => w.code === 'UNENFORCED_AMENDMENT_PENDING')).toBe(false);
  });

  it('確認に失敗しても主条文は返し、partial と PENDING_AMENDMENT_CHECK_FAILED に落とす', async () => {
    vi.mocked(getPendingAmendments).mockRejectedValue(new ExternalApiError('HTTP 503', { retryable: true }));
    const result = await getEvidenceBundle({ lawId: '322AC0000000049', article: '32', includePendingAmendments: true });
    expect(result.status).toBe('partial');
    expect(result.primary_evidence.body).toContain('使用者は');
    expect(result.primary_evidence.pending_amendments).toBeUndefined();
    expect(result.partial_failures).toContainEqual({ source: 'egov', target: 'law_revisions:322AC0000000049', reason: 'upstream_unavailable' });
    expect(result.warnings.some((w) => w.code === 'PENDING_AMENDMENT_CHECK_FAILED')).toBe(true);
  });
});
