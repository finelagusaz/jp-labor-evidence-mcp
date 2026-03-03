/**
 * 厚労省通達ビジネスロジック
 */

import { fetchMhlwSearch, fetchMhlwDocument, getMhlwDocUrl } from '../mhlw-client.js';
import { parseMhlwSearchResults, parseMhlwSearchCount, parseMhlwDocument } from '../mhlw-parser.js';
import type { MhlwSearchResult, MhlwDocument } from '../types.js';

export interface MhlwSearchResponse {
  results: MhlwSearchResult[];
  totalCount: number;
  page: number;
}

/**
 * 通達をキーワード検索する
 */
export async function searchMhlwTsutatsu(opts: {
  keyword: string;
  page?: number;
}): Promise<MhlwSearchResponse> {
  const page = opts.page ?? 0;
  const html = await fetchMhlwSearch(opts.keyword, page);
  const results = parseMhlwSearchResults(html);
  const totalCount = parseMhlwSearchCount(html);

  return { results, totalCount, page };
}

/**
 * 通達本文を取得する
 */
export async function getMhlwTsutatsu(opts: {
  dataId: string;
  pageNo?: number;
}): Promise<MhlwDocument> {
  const pageNo = opts.pageNo ?? 1;
  const html = await fetchMhlwDocument(opts.dataId, pageNo);

  // MHLW がエラーページを返した場合を検出（<title>エラー</title>）
  if (html.includes('<title>エラー</title>')) {
    const errMatch = html.match(/\[ERR[^\]]*\]([^<]*)/);
    const errMsg = errMatch ? errMatch[1].trim() : '通達が見つかりません';
    throw new Error(`MHLW エラー (dataId: ${opts.dataId}): ${errMsg}`);
  }

  const { title, body } = parseMhlwDocument(html);
  const url = getMhlwDocUrl(opts.dataId, pageNo);

  return { title, dataId: opts.dataId, body, url };
}
