/**
 * 厚労省通達ビジネスロジック
 */

import { fetchMhlwSearch, fetchMhlwDocument, getMhlwDocUrl } from '../mhlw-client.js';
import { NormalizedCache } from '../cache.js';
import { tsutatsuIndexRegistry } from '../indexes/tsutatsu-index.js';
import type { IndexSnapshotMeta } from '../indexes/types.js';
import { parseMhlwSearchResults, parseMhlwSearchCount, parseMhlwDocument } from '../mhlw-parser.js';
import type { MhlwSearchResult, MhlwDocument, PartialFailure, WarningMessage } from '../types.js';
import { ExternalApiError, ParseError, ValidationError } from '../errors.js';
import { observabilityRegistry } from '../observability.js';

export interface MhlwSearchResponse {
  status: 'ok' | 'partial' | 'unavailable';
  results: MhlwSearchResult[];
  totalCount: number;
  page: number;
  partialFailures: PartialFailure[];
  warnings: WarningMessage[];
  usedIndex: boolean;
  indexMeta?: IndexSnapshotMeta;
}

const mhlwSearchNormalizedCache = new NormalizedCache<MhlwSearchResponse>('mhlw_search_result', {
  defaultTtlMs: 10 * 60 * 1000,
  maxEntries: 64,
  maxBytes: 2_000_000,
});

const mhlwDocumentNormalizedCache = new NormalizedCache<MhlwDocument>('mhlw_document', {
  defaultTtlMs: 15 * 60 * 1000,
  maxEntries: 64,
  maxBytes: 2_000_000,
});

/**
 * 通達をキーワード検索する
 */
export async function searchMhlwTsutatsu(opts: {
  keyword: string;
  page?: number;
}): Promise<MhlwSearchResponse> {
  if (!opts.keyword.trim()) {
    throw new ValidationError('検索キーワードが空です');
  }
  const page = opts.page ?? 0;
  const indexHit = tsutatsuIndexRegistry.search('mhlw', opts.keyword, 20);
  if (indexHit.results.length > 0) {
    return {
      status: 'ok',
      results: indexHit.results.map((entry) => ({
        title: entry.title,
        dataId: entry.canonical_id.replace(/^mhlw:/, ''),
        date: entry.date ?? '',
        shubetsu: entry.number ?? '',
      })),
      totalCount: indexHit.results.length,
      page,
      partialFailures: [],
      warnings: [],
      usedIndex: true,
      indexMeta: indexHit.meta,
    };
  }
  const cacheKey = `${opts.keyword}|${page}`;
  const cached = mhlwSearchNormalizedCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  let html: string;
  try {
    html = await fetchMhlwSearch(opts.keyword, page);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    observabilityRegistry.recordPartialFailure('mhlw', 1);
    tsutatsuIndexRegistry.recordFailure('mhlw');

    return {
      status: 'unavailable',
      results: [],
      totalCount: 0,
      page,
      partialFailures: [{
        source: 'mhlw',
        target: `page:${page}`,
        reason: error instanceof Error ? error.message : String(error),
      }],
      warnings: [{
        code: 'MHLW_SEARCH_UNAVAILABLE',
        message: '厚生労働省 法令等データベースの検索結果を取得できませんでした。',
      }],
      usedIndex: false,
      indexMeta: tsutatsuIndexRegistry.getMeta('mhlw'),
    };
  }

  const results = parseMhlwSearchResults(html);
  const totalCount = parseMhlwSearchCount(html);
  const warnings: WarningMessage[] = [];

  if (totalCount > 0 && results.length === 0) {
    observabilityRegistry.recordParseError('mhlw');
    warnings.push({
      code: 'MHLW_SEARCH_PARSE_MISMATCH',
      message: '検索結果件数は取得できましたが、一覧の抽出に失敗した可能性があります。',
    });
  }

  const payload: MhlwSearchResponse = {
    status: 'ok',
    results,
    totalCount,
    page,
    partialFailures: [],
    warnings,
    usedIndex: false,
    indexMeta: tsutatsuIndexRegistry.getMeta('mhlw'),
  };
  tsutatsuIndexRegistry.recordMhlwResults(results);
  payload.indexMeta = tsutatsuIndexRegistry.getMeta('mhlw');
  mhlwSearchNormalizedCache.set(cacheKey, payload);
  return payload;
}

/**
 * 通達本文を取得する
 */
export async function getMhlwTsutatsu(opts: {
  dataId: string;
  pageNo?: number;
}): Promise<MhlwDocument> {
  if (!opts.dataId.trim()) {
    throw new ValidationError('dataId を指定してください');
  }
  const pageNo = opts.pageNo ?? 1;
  const cacheKey = `${opts.dataId}|${pageNo}`;
  const cached = mhlwDocumentNormalizedCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const html = await fetchMhlwDocument(opts.dataId, pageNo);

  // MHLW がエラーページを返した場合を検出（<title>エラー</title>）
  if (html.includes('<title>エラー</title>')) {
    const errMatch = html.match(/\[ERR[^\]]*\]([^<]*)/);
    const errMsg = errMatch ? errMatch[1].trim() : '通達が見つかりません';
    throw new ExternalApiError(`MHLW エラー (dataId: ${opts.dataId}): ${errMsg}`);
  }

  const { title, body, date, number } = parseMhlwDocument(html);
  if (!title.trim() && !body.trim()) {
    observabilityRegistry.recordParseError('mhlw');
    throw new ParseError(`MHLW 本文の解析に失敗しました (dataId: ${opts.dataId}, pageNo: ${pageNo})`);
  }
  const url = getMhlwDocUrl(opts.dataId, pageNo);

  const payload: MhlwDocument = { title, dataId: opts.dataId, body, date, number, url };
  mhlwDocumentNormalizedCache.set(cacheKey, payload);
  return payload;
}
