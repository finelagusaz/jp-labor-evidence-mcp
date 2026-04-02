/**
 * 法令サービス
 * e-Gov法令API v2 を使った条文取得・検索のビジネスロジック
 */

import { fetchLawData, searchLaws, getEgovUrl } from '../egov-client.js';
import { extractArticle, extractToc } from '../egov-parser.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { EgovLawSearchResult } from '../types.js';
import { resolveLawCandidates, type LawRegistryCandidate } from '../law-registry.js';
import type { WarningMessage } from '../types.js';

export interface GetLawArticleResult {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  article: string;
  articleCaption: string;
  text: string;
  egovUrl: string;
}

export interface GetLawTocResult {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  toc: string;
  egovUrl: string;
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
}

export interface ResolveLawResult {
  query: string;
  resolution: 'resolved' | 'ambiguous' | 'not_found';
  candidates: LawRegistryCandidate[];
  warnings: WarningMessage[];
}

/**
 * 法令の特定条文を取得
 */
export async function getLawArticle(params: {
  lawName: string;
  article: string;
  paragraph?: number;
  item?: number;
}): Promise<GetLawArticleResult> {
  if (!params.lawName.trim()) {
    throw new ValidationError('法令名または law_id を指定してください。');
  }
  if (!params.article.trim()) {
    throw new ValidationError('条文番号を指定してください。');
  }

  const { data, lawId, lawTitle } = await fetchLawData(params.lawName);
  const egovUrl = getEgovUrl(lawId);

  const result = extractArticle(data, params.article, params.paragraph, params.item);

  if (!result) {
    const articleDesc = `第${params.article}条`;
    const paraDesc = params.paragraph ? `第${params.paragraph}項` : '';
    const itemDesc = params.item ? `第${params.item}号` : '';
    throw new NotFoundError(
      `${lawTitle} ${articleDesc}${paraDesc}${itemDesc} が見つかりませんでした。条文番号を確認してください。`
    );
  }

  return {
    lawId,
    lawTitle,
    lawNum: data.law_info.law_num,
    promulgationDate: data.law_info.promulgation_date,
    article: params.article,
    articleCaption: result.articleCaption ?? '',
    text: result.text,
    egovUrl,
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

  const { data, lawId, lawTitle } = await fetchLawData(params.lawName);
  const egovUrl = getEgovUrl(lawId);
  const toc = extractToc(data);

  return {
    lawId,
    lawTitle,
    lawNum: data.law_info.law_num,
    promulgationDate: data.law_info.promulgation_date,
    toc,
    egovUrl,
  };
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
  const results = await searchLaws(params.keyword, limit, params.lawType);

  return {
    keyword: params.keyword,
    results: results.map((r: EgovLawSearchResult) => ({
      lawTitle: r.revision_info?.law_title ?? r.current_revision_info?.law_title ?? '',
      lawId: r.law_info.law_id,
      lawNum: r.law_info.law_num,
      lawType: r.law_info.law_type,
      egovUrl: getEgovUrl(r.law_info.law_id),
    })),
  };
}

export async function resolveLaw(params: {
  query: string;
}): Promise<ResolveLawResult> {
  const query = params.query.trim();
  if (!query) {
    throw new ValidationError('法令名、略称、または law_id を指定してください。');
  }

  const candidates = resolveLawCandidates(query);
  const resolution =
    candidates.length === 0 ? 'not_found' :
    candidates.length === 1 ? 'resolved' :
    'ambiguous';

  if (candidates.length > 0) {
    return {
      query,
      resolution,
      candidates,
      warnings: [],
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
    };
  }

  return {
    query,
    resolution: 'not_found',
    candidates: [],
    warnings: [],
  };
}

export async function getArticleByLawId(params: {
  lawId: string;
  article: string;
  paragraph?: number;
  item?: number;
}): Promise<GetLawArticleResult> {
  if (!params.lawId.trim()) {
    throw new ValidationError('law_id を指定してください。');
  }

  const result = await getLawArticle({
    lawName: params.lawId,
    article: params.article,
    paragraph: params.paragraph,
    item: params.item,
  });

  return result;
}
