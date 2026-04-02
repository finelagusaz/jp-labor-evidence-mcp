/**
 * JAISH安衛通達ビジネスロジック
 */

import { fetchJaishIndex, fetchJaishPage, getJaishUrl, JAISH_INDEX_PAGES } from '../jaish-client.js';
import { parseJaishIndex, filterJaishEntries, parseJaishDocument } from '../jaish-parser.js';
import type { JaishIndexEntry, JaishDocument, PartialFailure, WarningMessage } from '../types.js';
import { ParseError, ValidationError } from '../errors.js';
import { observabilityRegistry } from '../observability.js';

export interface JaishSearchResponse {
  status: 'ok' | 'partial' | 'unavailable';
  results: JaishIndexEntry[];
  pagesSearched: number;
  failedPages: PartialFailure[];
  warnings: WarningMessage[];
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
  const keyword = opts.keyword.trim();
  if (!keyword) {
    throw new ValidationError('検索キーワードが空です');
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new ValidationError(`不正な limit です: ${opts.limit}`);
  }
  if (opts.maxPages !== undefined && (!Number.isInteger(opts.maxPages) || opts.maxPages < 1)) {
    throw new ValidationError(`不正な maxPages です: ${opts.maxPages}`);
  }

  const limit = Math.min(opts.limit ?? 10, 30);
  const maxPages = Math.min(opts.maxPages ?? 5, JAISH_INDEX_PAGES.length);

  const allResults: JaishIndexEntry[] = [];
  let pagesSearched = 0;
  const failedPages: PartialFailure[] = [];
  const warnings: WarningMessage[] = [];

  for (let i = 0; i < maxPages && allResults.length < limit; i++) {
    const path = JAISH_INDEX_PAGES[i];
    try {
      const html = await fetchJaishIndex(path);
      const entries = parseJaishIndex(html);
      const filtered = filterJaishEntries(entries, keyword);
      allResults.push(...filtered);
      pagesSearched++;
    } catch (error) {
      observabilityRegistry.recordPartialFailure('jaish', 1);
      failedPages.push({
        source: 'jaish',
        target: path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedPages.length > 0) {
    warnings.push({
      code: failedPages.length === maxPages ? 'JAISH_SEARCH_UNAVAILABLE' : 'JAISH_SEARCH_PARTIAL',
      message: failedPages.length === maxPages
        ? 'JAISH の年度別インデックス取得にすべて失敗しました。'
        : 'JAISH の一部年度インデックス取得に失敗しました。',
    });
  }

  const status =
    failedPages.length === 0 ? 'ok' :
    pagesSearched > 0 ? 'partial' :
    'unavailable';

  return {
    status,
    results: allResults.slice(0, limit),
    pagesSearched,
    failedPages,
    warnings,
  };
}

/**
 * 個別通達の本文を取得する
 */
export async function getJaishTsutatsu(opts: {
  url: string;
}): Promise<JaishDocument> {
  if (!opts.url.trim()) {
    throw new ValidationError('JAISH の URL またはパスを指定してください');
  }
  const html = await fetchJaishPage(opts.url);
  const { title, body, date, number } = parseJaishDocument(html);
  if (!title.trim() && !body.trim()) {
    observabilityRegistry.recordParseError('jaish');
    throw new ParseError(`JAISH 本文の解析に失敗しました: ${opts.url}`);
  }
  const fullUrl = getJaishUrl(opts.url);

  return { title, body, date, number, url: fullUrl };
}
