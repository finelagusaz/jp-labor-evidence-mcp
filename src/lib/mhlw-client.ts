/**
 * 厚生労働省 法令等データベース HTTP クライアント
 * https://www.mhlw.go.jp/hourei/
 */

import { mhlwSearchCache, mhlwDocCache } from './cache.js';
import { ValidationError } from './errors.js';

const BASE_URL = 'https://www.mhlw.go.jp/web';
const REQUEST_DELAY_MS = 200;
const MAX_CACHEABLE_HTML_CHARS = 500_000;

let lastRequestTime = 0;

async function throttledFetch(url: string): Promise<string> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'labor-law-mcp/0.2.0 (MCP server for Japanese labor law)',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 通達をキーワード検索する
 * @param keyword 検索キーワード
 * @param page ページ番号（0始まり）
 */
export async function fetchMhlwSearch(keyword: string, page = 0): Promise<string> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    throw new ValidationError('検索キーワードが空です');
  }
  if (!Number.isInteger(page) || page < 0 || page > 999) {
    throw new ValidationError(`不正なページ番号です: ${page}`);
  }
  const cacheKey = `search:${normalizedKeyword}:${page}`;
  const cached = mhlwSearchCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    keyword: normalizedKeyword,
    type: '1',
    mode: '0',
    page: String(page),
  });
  const url = `${BASE_URL}/t_docsrch_keyword?${params}`;
  const html = await throttledFetch(url);
  if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
    mhlwSearchCache.set(cacheKey, html);
  }
  return html;
}

/**
 * 通達本文を取得する（dataId指定）
 * @param dataId 文書ID（例: "00tb2035"）
 * @param pageNo ページ番号（デフォルト1）
 */
export async function fetchMhlwDocument(dataId: string, pageNo = 1): Promise<string> {
  const normalizedDataId = dataId.trim();
  // dataIdの形式バリデーション（英数字・ハイフン・アンダースコアのみ許可）
  if (!/^[\w-]{1,64}$/.test(normalizedDataId)) {
    throw new ValidationError(`不正なdataIdです: "${dataId}"`);
  }
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 999) {
    throw new ValidationError(`不正なページ番号です: ${pageNo}`);
  }
  const cacheKey = `doc:${normalizedDataId}:${pageNo}`;
  const cached = mhlwDocCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    dataId: normalizedDataId,
    dataType: '1',
    pageNo: String(pageNo),
  });
  const url = `${BASE_URL}/t_doc?${params}`;
  const html = await throttledFetch(url);
  if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
    mhlwDocCache.set(cacheKey, html);
  }
  return html;
}

/**
 * MHLW法令等DBの通達URLを生成する
 */
export function getMhlwDocUrl(dataId: string, pageNo = 1): string {
  return `${BASE_URL}/t_doc?dataId=${dataId}&dataType=1&pageNo=${pageNo}`;
}
