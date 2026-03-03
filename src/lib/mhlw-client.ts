/**
 * 厚生労働省 法令等データベース HTTP クライアント
 * https://www.mhlw.go.jp/hourei/
 */

import { mhlwSearchCache, mhlwDocCache } from './cache.js';

const BASE_URL = 'https://www.mhlw.go.jp/web';
const REQUEST_DELAY_MS = 200;

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
  if (!keyword.trim()) {
    throw new Error('検索キーワードが空です');
  }
  const cacheKey = `search:${keyword}:${page}`;
  const cached = mhlwSearchCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    keyword,
    type: '1',
    mode: '0',
    page: String(page),
  });
  const url = `${BASE_URL}/t_docsrch_keyword?${params}`;
  const html = await throttledFetch(url);
  mhlwSearchCache.set(cacheKey, html);
  return html;
}

/**
 * 通達本文を取得する（dataId指定）
 * @param dataId 文書ID（例: "00tb2035"）
 * @param pageNo ページ番号（デフォルト1）
 */
export async function fetchMhlwDocument(dataId: string, pageNo = 1): Promise<string> {
  // dataIdの形式バリデーション（英数字・ハイフン・アンダースコアのみ許可）
  if (!/^[\w-]+$/.test(dataId)) {
    throw new Error(`不正なdataIdです: "${dataId}"`);
  }
  const cacheKey = `doc:${dataId}:${pageNo}`;
  const cached = mhlwDocCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    dataId,
    dataType: '1',
    pageNo: String(pageNo),
  });
  const url = `${BASE_URL}/t_doc?${params}`;
  const html = await throttledFetch(url);
  mhlwDocCache.set(cacheKey, html);
  return html;
}

/**
 * MHLW法令等DBの通達URLを生成する
 */
export function getMhlwDocUrl(dataId: string, pageNo = 1): string {
  return `${BASE_URL}/t_doc?dataId=${dataId}&dataType=1&pageNo=${pageNo}`;
}
