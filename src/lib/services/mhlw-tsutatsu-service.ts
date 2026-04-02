/**
 * 厚労省通達ビジネスロジック
 */

import { fetchMhlwSearch, fetchMhlwDocument, getMhlwDocUrl } from '../mhlw-client.js';
import { parseMhlwSearchResults, parseMhlwSearchCount, parseMhlwDocument } from '../mhlw-parser.js';
import type { MhlwSearchResult, MhlwDocument, PartialFailure, WarningMessage } from '../types.js';
import { ExternalApiError, ValidationError } from '../errors.js';

export interface MhlwSearchResponse {
  status: 'ok' | 'unavailable';
  results: MhlwSearchResult[];
  totalCount: number;
  page: number;
  partialFailures: PartialFailure[];
  warnings: WarningMessage[];
}

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
  let html: string;
  try {
    html = await fetchMhlwSearch(opts.keyword, page);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

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
    };
  }

  const results = parseMhlwSearchResults(html);
  const totalCount = parseMhlwSearchCount(html);
  const warnings: WarningMessage[] = [];

  if (totalCount > 0 && results.length === 0) {
    warnings.push({
      code: 'MHLW_SEARCH_PARSE_MISMATCH',
      message: '検索結果件数は取得できましたが、一覧の抽出に失敗した可能性があります。',
    });
  }

  return {
    status: 'ok',
    results,
    totalCount,
    page,
    partialFailures: [],
    warnings,
  };
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
  const html = await fetchMhlwDocument(opts.dataId, pageNo);

  // MHLW がエラーページを返した場合を検出（<title>エラー</title>）
  if (html.includes('<title>エラー</title>')) {
    const errMatch = html.match(/\[ERR[^\]]*\]([^<]*)/);
    const errMsg = errMatch ? errMatch[1].trim() : '通達が見つかりません';
    throw new ExternalApiError(`MHLW エラー (dataId: ${opts.dataId}): ${errMsg}`);
  }

  const { title, body } = parseMhlwDocument(html);
  const url = getMhlwDocUrl(opts.dataId, pageNo);

  return { title, dataId: opts.dataId, body, url };
}
