/**
 * 法令サービス
 * e-Gov法令API v2 を使った条文取得・検索のビジネスロジック
 */

import { fetchLawData, fetchLawRevisions, searchLaws, getEgovUrl } from '../egov-client.js';
import { buildPendingAmendments, isLatestEnforcedRevision } from '../evidence-metadata.js';
import { NormalizedCache } from '../cache.js';
import { extractArticle, extractSupplProvision, extractToc, listSupplProvisions, normalizeArticleCaption, normalizeSubitemPath, selectSupplProvision, type SupplProvisionInfo } from '../egov-parser.js';
import { lawNumMatches, parseLawNum, promulgationSortKey } from '../law-num.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { getEgovIndexMeta, resolveLawFromEgovIndex, searchEgovIndex } from '../indexes/egov-index.js';
import { indexMetadataRegistry } from '../indexes/index-metadata.js';
import type { IndexSnapshotMeta } from '../indexes/types.js';
import type { EgovLawSearchResult, EgovRevisionInfo, PendingAmendment } from '../types.js';
import { findDelegatedLawCandidates, getKnownLawCandidateById, type LawRegistryCandidate } from '../law-registry.js';
import type { WarningMessage } from '../types.js';
import { decideSearchRouting, type SearchRoute } from '../search-routing-policy.js';

export interface GetLawArticleResult {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  /** 附則で条を省いたときは '' */
  article: string;
  articleCaption: string;
  text: string;
  /** text に条見出しの行が含まれるか（formatArticleBody が先頭行を足すかを決める） */
  captionInText?: boolean;
  egovUrl: string;
  revisionInfo?: EgovRevisionInfo;
  /** 指定された項、または item から特定した項 */
  paragraph?: number;
  /** 細分の正規形（"ロ/1/iii"） */
  subitem?: string;
  supplementary?: SupplementaryInfo;
}

export interface SupplementaryInfo {
  key: string;
  /** e-Gov の AmendLawNum（加工しない）。制定時附則は undefined */
  amendLawNum?: string;
  extract: boolean;
}

export interface SupplProvisionListItem {
  key: string;
  amendLawNum?: string;
  extract: boolean;
  /** 先頭 20 件まで */
  articleNums: string[];
  articleCount: number;
  paragraphCount: number;
}

export interface ListSupplProvisionsResult {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  egovUrl: string;
  revisionInfo?: EgovRevisionInfo;
  total: number;
  hasMore: boolean;
  items: SupplProvisionListItem[];
}

export interface GetLawTocResult {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  toc: string;
  egovUrl: string;
  revisionInfo?: EgovRevisionInfo;
}

export interface SearchLawResultItem {
  lawTitle: string;
  lawId: string;
  lawNum: string;
  lawType: string;
  egovUrl: string;
}

export interface SearchLawResult {
  keyword: string;
  results: SearchLawResultItem[];
  usedIndex: boolean;
  indexMeta?: IndexSnapshotMeta;
  warnings: WarningMessage[];
  route: SearchRoute;
}

export interface ResolveLawResult {
  query: string;
  resolution: 'resolved' | 'ambiguous' | 'not_found';
  candidates: LawRegistryCandidate[];
  warnings: WarningMessage[];
  usedIndex: boolean;
  indexMeta?: IndexSnapshotMeta;
}

export interface FindRelatedSourcesResult {
  lawId: string;
  lawTitle: string;
  delegatedLaws: LawRegistryCandidate[];
  searchKeywords: string[];
  warnings: WarningMessage[];
}

const lawArticleNormalizedCache = new NormalizedCache<GetLawArticleResult>('law_article', {
  defaultTtlMs: 15 * 60 * 1000,
  maxEntries: 128,
  maxBytes: 2_000_000,
});

const lawTocNormalizedCache = new NormalizedCache<GetLawTocResult>('law_toc', {
  defaultTtlMs: 30 * 60 * 1000,
  maxEntries: 64,
  maxBytes: 2_000_000,
});

const lawSearchNormalizedCache = new NormalizedCache<SearchLawResult>('law_search_result', {
  defaultTtlMs: 10 * 60 * 1000,
  maxEntries: 64,
  maxBytes: 2_000_000,
});

/**
 * 法令の特定条文を取得
 */
export async function getLawArticle(params: {
  lawName: string;
  article?: string;
  paragraph?: number;
  item?: number | string;
  subitem?: string;
  supplementary?: string;
}): Promise<GetLawArticleResult> {
  if (!params.lawName.trim()) {
    throw new ValidationError('法令名または law_id を指定してください。');
  }
  const article = params.article?.trim() || undefined;
  const supplementary = params.supplementary?.trim() || undefined;
  if (!article && !supplementary) {
    throw new ValidationError('条文番号を指定してください（附則なら supplementary を指定すると条文番号を省けます）。');
  }
  if (article && !supplementary && /^附則/.test(article)) {
    throw new ValidationError(
      `附則は supplementary で指定してください（例: supplementary: "制定" または改正法の法令番号、article: "1"）。附則の一覧は list_suppl_provisions で確認できます。`,
    );
  }
  if (params.subitem !== undefined && params.item === undefined) {
    throw new ValidationError('subitem を指定するときは item（号）も指定してください。');
  }
  const subitemPath = params.subitem !== undefined ? normalizeSubitemPath(params.subitem) : undefined;
  if (subitemPath !== undefined && subitemPath.length === 0) {
    throw new ValidationError(`subitem「${params.subitem}」を解釈できません。例: "イ", "イ (1)", "イ-(1)-(i)"`);
  }

  const cacheKey = [params.lawName, supplementary ?? '', article ?? '', params.paragraph ?? '', params.item ?? '', subitemPath?.join('/') ?? ''].join('|');
  const cached = lawArticleNormalizedCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { data, lawId, lawTitle } = await fetchLawData(params.lawName);
  const egovUrl = getEgovUrl(lawId);
  const target = { article, paragraph: params.paragraph, item: params.item, subitem: params.subitem };

  let suppl: SupplProvisionInfo | null = null;
  if (supplementary) {
    suppl = selectSupplProvision(data, supplementary);
    if (!suppl) {
      throw new NotFoundError(
        `${lawTitle} に附則「${supplementary}」が見つかりませんでした。list_suppl_provisions で附則の一覧を確認してください。` +
          '未施行の改正の附則は、現行版の本文にまだ収録されていないことがあります。',
      );
    }
  }
  const result = suppl
    ? extractSupplProvision(data, suppl, target)
    : extractArticle(data, article!, params.paragraph, params.item, params.subitem);

  if (!result) {
    const supplDesc = suppl ? `附則（${suppl.key}）` : '';
    const articleDesc = article ? `第${article}条` : '';
    const paraDesc = params.paragraph ? `第${params.paragraph}項` : '';
    const itemDesc = params.item !== undefined ? `第${params.item}号` : '';
    const subitemDesc = params.subitem ?? '';
    throw new NotFoundError(
      `${lawTitle} ${supplDesc}${articleDesc}${paraDesc}${itemDesc}${subitemDesc} が見つかりませんでした。条文番号を確認してください。`
    );
  }

  const payload: GetLawArticleResult = {
    lawId,
    lawTitle,
    lawNum: data.law_info.law_num,
    promulgationDate: data.law_info.promulgation_date,
    article: article ?? '',
    articleCaption: result.articleCaption ?? '',
    text: result.text,
    captionInText: result.captionInText,
    egovUrl,
    revisionInfo: data.revision_info,
    paragraph: params.paragraph ?? result.matchedParagraph,
    subitem: subitemPath?.join('/'),
    supplementary: suppl ? { key: suppl.key, amendLawNum: suppl.amendLawNum, extract: suppl.extract } : undefined,
  };
  lawArticleNormalizedCache.set(cacheKey, payload);
  return payload;
}

const SUPPL_ARTICLE_NUMS_LIMIT = 20;

/**
 * 附則の一覧を新しい順（公布日）で返す。amendmentLawNum は年だけでもよい
 */
export async function listSupplProvisionsByLawId(params: {
  lawId: string;
  amendmentLawNum?: string;
  limit?: number;
  offset?: number;
}): Promise<ListSupplProvisionsResult> {
  if (!params.lawId.trim()) {
    throw new ValidationError('law_id を指定してください。');
  }
  const filterInput = params.amendmentLawNum?.trim() || undefined;
  const filter = filterInput ? parseLawNum(filterInput) : undefined;
  if (filterInput && !filter) {
    throw new ValidationError(
      `amendment_law_num「${filterInput}」を解釈できません。例: "令和8年"、"令和8年法律第46号"、"令和八年法律第四十六号"`,
    );
  }

  const { data, lawId, lawTitle } = await fetchLawData(params.lawId);
  const all = listSupplProvisions(data);
  const filtered = filter ? all.filter((s) => s.parsed && lawNumMatches(filter, s.parsed)) : all;
  // 公布日の新しい順。公布日が無いもの（制定時附則など）は e-Gov の並び（古い順）の位置で補う
  const sorted = [...filtered].sort((a, b) => {
    const ka = a.parsed ? promulgationSortKey(a.parsed) : undefined;
    const kb = b.parsed ? promulgationSortKey(b.parsed) : undefined;
    if (ka !== undefined && kb !== undefined && ka !== kb) return kb - ka;
    return b.index - a.index;
  });
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 30;
  const page = sorted.slice(offset, offset + limit);

  return {
    lawId,
    lawTitle,
    lawNum: data.law_info.law_num,
    promulgationDate: data.law_info.promulgation_date,
    egovUrl: getEgovUrl(lawId),
    revisionInfo: data.revision_info,
    total: sorted.length,
    hasMore: offset + page.length < sorted.length,
    items: page.map((s) => ({
      key: s.key,
      amendLawNum: s.amendLawNum,
      extract: s.extract,
      articleNums: s.articleNums.slice(0, SUPPL_ARTICLE_NUMS_LIMIT),
      articleCount: s.articleNums.length,
      paragraphCount: s.paragraphCount,
    })),
  };
}

/**
 * 法令の目次を取得
 */
export async function getLawToc(params: {
  lawName: string;
}): Promise<GetLawTocResult> {
  if (!params.lawName.trim()) {
    throw new ValidationError('法令名または law_id を指定してください。');
  }

  const cached = lawTocNormalizedCache.get(params.lawName);
  if (cached) {
    return cached;
  }

  const { data, lawId, lawTitle } = await fetchLawData(params.lawName);
  const egovUrl = getEgovUrl(lawId);
  const toc = extractToc(data);

  const payload = {
    lawId,
    lawTitle,
    lawNum: data.law_info.law_num,
    promulgationDate: data.law_info.promulgation_date,
    toc,
    egovUrl,
    revisionInfo: data.revision_info,
  };
  lawTocNormalizedCache.set(params.lawName, payload);
  return payload;
}

/**
 * 法令をキーワード検索
 */
export async function searchLaw(params: {
  keyword: string;
  lawType?: string;
  limit?: number;
}): Promise<SearchLawResult> {
  if (!params.keyword.trim()) {
    throw new ValidationError('検索キーワードを指定してください。');
  }

  const limit = Math.min(params.limit ?? 10, 20);
  const cacheKey = `${params.keyword}|${limit}|${params.lawType ?? ''}`;
  const cached = lawSearchNormalizedCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const indexResults = searchEgovIndex(params.keyword, params.lawType, limit);
  const indexMeta = getEgovIndexMeta();
  indexMetadataRegistry.recordQuery('egov', indexResults.length > 0);
  const routing = decideSearchRouting({
    indexHit: indexResults.length > 0,
    indexMeta,
  });
  if (indexResults.length > 0) {
    const payload = {
      keyword: params.keyword,
      results: indexResults.map((entry) => ({
        lawTitle: entry.law_title,
        lawId: entry.law_id,
        lawNum: entry.law_num ?? '',
        lawType: entry.law_type,
        egovUrl: entry.source_url,
      })),
      usedIndex: true,
      indexMeta,
      warnings: routing.warnings,
      route: routing.route,
    };
    lawSearchNormalizedCache.set(cacheKey, payload);
    return payload;
  }

  if (!routing.allowUpstreamFallback) {
    const payload = {
      keyword: params.keyword,
      results: [],
      usedIndex: true,
      indexMeta,
      warnings: routing.warnings,
      route: routing.route,
    };
    lawSearchNormalizedCache.set(cacheKey, payload);
    return payload;
  }

  const results = await searchLaws(params.keyword, limit, params.lawType);

  const payload = {
    keyword: params.keyword,
    results: results.map((r: EgovLawSearchResult) => ({
      lawTitle: r.revision_info?.law_title ?? r.current_revision_info?.law_title ?? '',
      lawId: r.law_info.law_id,
      lawNum: r.law_info.law_num,
      lawType: r.law_info.law_type,
      egovUrl: getEgovUrl(r.law_info.law_id),
    })),
    usedIndex: false,
    indexMeta,
    warnings: routing.warnings,
    route: routing.route,
  };
  lawSearchNormalizedCache.set(cacheKey, payload);
  return payload;
}

export async function resolveLaw(params: {
  query: string;
}): Promise<ResolveLawResult> {
  const query = params.query.trim();
  if (!query) {
    throw new ValidationError('法令名、略称、または law_id を指定してください。');
  }

  const indexResult = resolveLawFromEgovIndex(query);

  if (indexResult.resolution !== 'not_found') {
    return {
      query,
      resolution: indexResult.resolution,
      candidates: indexResult.candidates,
      warnings: [],
      usedIndex: true,
      indexMeta: indexResult.meta,
    };
  }

  const upstreamResults = await searchLaws(query, 10);
  const exactMatches = upstreamResults
    .filter((result) => {
      const titles = [
        result.revision_info?.law_title,
        result.current_revision_info?.law_title,
        result.revision_info?.abbrev,
        result.current_revision_info?.abbrev,
      ].filter((value): value is string => Boolean(value));
      return titles.some((value) => value === query);
    })
    .map((result) => {
      const lawTitle = result.revision_info?.law_title ?? result.current_revision_info?.law_title ?? result.law_info.law_id;
      return {
        lawId: result.law_info.law_id,
        lawTitle,
        lawType: result.law_info.law_type,
        sourceUrl: getEgovUrl(result.law_info.law_id),
        aliases: [
          result.revision_info?.abbrev,
          result.current_revision_info?.abbrev,
        ].filter((value): value is string => Boolean(value)),
      } satisfies LawRegistryCandidate;
    });

  if (exactMatches.length > 0) {
    return {
      query,
      resolution: exactMatches.length === 1 ? 'resolved' : 'ambiguous',
      candidates: exactMatches,
      warnings: [{
        code: 'UPSTREAM_EXACT_MATCH',
        message: '内部 registry に未登録のため、e-Gov 検索結果の厳密一致から候補を補完しました。',
      }],
      usedIndex: false,
      indexMeta: getEgovIndexMeta(),
    };
  }

  return {
    query,
    resolution: 'not_found',
    candidates: [],
    warnings: [],
    usedIndex: true,
    indexMeta: getEgovIndexMeta(),
  };
}

export async function getArticleByLawId(params: {
  lawId: string;
  article?: string;
  paragraph?: number;
  item?: number | string;
  subitem?: string;
  supplementary?: string;
}): Promise<GetLawArticleResult> {
  if (!params.lawId.trim()) {
    throw new ValidationError('law_id を指定してください。');
  }

  return await getLawArticle({
    lawName: params.lawId,
    article: params.article,
    paragraph: params.paragraph,
    item: params.item,
    subitem: params.subitem,
    supplementary: params.supplementary,
  });
}

export async function findRelatedSources(params: {
  lawId: string;
  article?: string;
  articleCaption?: string;
}): Promise<FindRelatedSourcesResult> {
  if (!params.lawId.trim()) {
    throw new ValidationError('law_id を指定してください。');
  }

  const { data, lawId, lawTitle } = await fetchLawData(params.lawId);
  const delegatedLaws = findDelegatedLawCandidates(lawId);
  const searchKeywords = buildRelatedSearchKeywords({
    lawId,
    lawTitle,
    article: params.article,
    articleCaption: params.articleCaption !== undefined ? normalizeArticleCaption(params.articleCaption) : undefined,
  });

  const warnings: WarningMessage[] = delegatedLaws.length === 0
    ? [{
        code: 'NO_DELEGATED_LAWS_CONFIGURED',
        message: 'この法令に対する委任先法令の対応表は未登録です。',
      }]
    : [];

  return {
    lawId,
    lawTitle,
    delegatedLaws,
    searchKeywords,
    warnings,
  };
}

function buildRelatedSearchKeywords(params: {
  lawId: string;
  lawTitle: string;
  article?: string;
  articleCaption?: string;
}): string[] {
  const articleRefCandidates = params.article
    ? buildArticleReferenceCandidates(params.article)
    : [];
  const knownCandidate = getKnownLawCandidateById(params.lawId);
  const lawAliases = knownCandidate?.aliases ?? [];
  const seed = [
    ...getPracticeKeywords(params.lawId, params.article),
    params.articleCaption,
    params.article ? `${params.lawTitle} ${normalizeArticleReference(params.article)}` : undefined,
    ...lawAliases.map((alias) =>
      params.article ? `${alias} ${normalizeArticleReference(params.article)}` : alias
    ),
    ...articleRefCandidates,
    params.lawTitle,
  ];

  return Array.from(
    new Set(seed.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  ).slice(0, 6);
}

function buildArticleReferenceCandidates(article: string): string[] {
  const normalized = normalizeArticleReference(article);
  const bare = normalized.replace(/^第/, '').replace(/条$/, '');
  return Array.from(new Set([
    normalized,
    bare,
    `第${bare}条`,
    `${bare}条`,
  ]));
}

function normalizeArticleReference(article: string): string {
  const raw = article.replace(/_/g, 'の').trim();
  return /^第.+条$/.test(raw) ? raw : `第${raw.replace(/^第/, '').replace(/条$/, '')}条`;
}

function getPracticeKeywords(lawId: string, article?: string): string[] {
  const normalizedArticle = article?.replace(/_/g, 'の').replace(/^第/, '').replace(/条$/, '');
  const key = normalizedArticle ? `${lawId}:${normalizedArticle}` : lawId;
  return RELATED_SOURCE_KEYWORD_MAP[key] ?? [];
}

const RELATED_SOURCE_KEYWORD_MAP: Record<string, string[]> = {
  '322AC0000000049:36': ['36協定', '時間外労働', '休日労働'],
};

/**
 * 法令の未施行改正を取得
 */
export async function getPendingAmendments(
  lawId: string,
): Promise<{ amendments: PendingAmendment[]; excludedCount: number }> {
  const { revisions } = await fetchLawRevisions(lawId);
  return buildPendingAmendments(revisions);
}

/**
 * law_data の版に付いた PreviousEnforced がタグ付け遅れかを /law_revisions で照合する。
 * PreviousEnforced 以外では追加取得せず false。取得失敗も false（警告を残す側に倒す）。
 * 結果は条文の normalized cache に焼き込まない（/law_revisions 側は raw cache が効く）
 */
export async function verifyLatestEnforced(
  lawId: string,
  revisionInfo: EgovRevisionInfo | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (revisionInfo?.current_revision_status?.trim() !== 'PreviousEnforced') return false;
  try {
    const { revisions } = await fetchLawRevisions(lawId);
    return isLatestEnforcedRevision(revisionInfo, revisions, now);
  } catch {
    return false;
  }
}

/**
 * 附則の key（「令和8年法律第46号」）に対応する改正法の題名を /law_revisions から引く。
 * amendment_law_num は十を使う漢数字なので law-num の正規形で照合する。一覧に無ければ undefined
 */
export async function findAmendmentLawTitle(lawId: string, supplKey: string): Promise<string | undefined> {
  const wanted = parseLawNum(supplKey);
  if (!wanted || wanted.number === undefined) return undefined;
  const { revisions } = await fetchLawRevisions(lawId);
  for (const rev of revisions ?? []) {
    const parsed = rev.amendment_law_num ? parseLawNum(rev.amendment_law_num) : undefined;
    const title = rev.amendment_law_title?.trim();
    if (parsed && title && lawNumMatches(wanted, parsed)) return title;
  }
  return undefined;
}

