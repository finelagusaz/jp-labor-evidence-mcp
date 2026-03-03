/**
 * JAISH安衛通達ビジネスロジック
 */

import { fetchJaishIndex, fetchJaishPage, getJaishUrl, JAISH_INDEX_PAGES } from '../jaish-client.js';
import { parseJaishIndex, filterJaishEntries, parseJaishDocument } from '../jaish-parser.js';
import type { JaishIndexEntry, JaishDocument } from '../types.js';

export interface JaishSearchResponse {
  results: JaishIndexEntry[];
  pagesSearched: number;
}

/**
 * 安衛通達をキーワード検索する
 *
 * 最新年度から順にインデックスページをクロールし、
 * クライアントサイドでキーワードフィルタを行う。
 *
 * @param opts.keyword 検索キーワード
 * @param opts.limit 最大件数（デフォルト10）
 * @param opts.maxPages 検索する最大年度数（デフォルト5）
 */
export async function searchJaishTsutatsu(opts: {
  keyword: string;
  limit?: number;
  maxPages?: number;
}): Promise<JaishSearchResponse> {
  const limit = Math.min(opts.limit ?? 10, 30);
  const maxPages = Math.min(opts.maxPages ?? 5, JAISH_INDEX_PAGES.length);

  const allResults: JaishIndexEntry[] = [];
  let pagesSearched = 0;

  for (let i = 0; i < maxPages && allResults.length < limit; i++) {
    const path = JAISH_INDEX_PAGES[i];
    try {
      const html = await fetchJaishIndex(path);
      const entries = parseJaishIndex(html);
      const filtered = filterJaishEntries(entries, opts.keyword);
      allResults.push(...filtered);
      pagesSearched++;
    } catch {
      // 404 or timeout — skip this year
      continue;
    }
  }

  return {
    results: allResults.slice(0, limit),
    pagesSearched,
  };
}

/**
 * 個別通達の本文を取得する
 */
export async function getJaishTsutatsu(opts: {
  url: string;
}): Promise<JaishDocument> {
  const html = await fetchJaishPage(opts.url);
  const { title, body } = parseJaishDocument(html);
  const fullUrl = getJaishUrl(opts.url);

  return { title, body, url: fullUrl };
}
