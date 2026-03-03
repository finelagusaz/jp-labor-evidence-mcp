/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 *
 * takurot版を参考にレート制限を実装
 */

import { lawDataCache, lawSearchCache } from './cache.js';
import type { EgovLawSearchResult, EgovLawData } from './types.js';
import { resolveLawName } from './law-registry.js';
import { extractLawTitle } from './egov-parser.js';

const EGOV_API_BASE = 'https://laws.e-gov.go.jp/api/2';
const MIN_REQUEST_INTERVAL_MS = 200; // 5 req/sec (takurot版参考)

let lastRequestTime = 0;

/** レート制限: 前回リクエストから最低200ms空ける */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * 法令名またはlaw_idから法令全文を取得
 */
export async function fetchLawData(lawNameOrId: string): Promise<{
  data: EgovLawData;
  lawId: string;
  lawTitle: string;
}> {
  // law_idを解決
  let lawId: string;
  const { name, lawId: resolvedId } = resolveLawName(lawNameOrId);

  if (resolvedId) {
    lawId = resolvedId;
  } else if (/^\d{3}[A-Z]{2}\d{10}$/.test(lawNameOrId)) {
    // e-Gov law_id形式（例: 322AC0000000049）ならそのまま使用
    lawId = lawNameOrId;
  } else {
    // 名前で検索してlaw_idを取得
    const results = await searchLaws(name, 1);
    if (results.length === 0) {
      throw new Error(`法令が見つかりません: "${name}"`);
    }
    lawId = results[0].law_info.law_id;
  }

  // キャッシュチェック
  const cached = lawDataCache.get(lawId);
  if (cached) {
    const data = JSON.parse(cached) as EgovLawData;
    return { data, lawId, lawTitle: extractLawTitle(data) };
  }

  // e-Gov API v2 から取得
  await rateLimit();
  const url = `${EGOV_API_BASE}/law_data/${lawId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'labor-law-mcp/0.2.0 (MCP server for Japanese labor law)',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`e-Gov API タイムアウト (law_id: ${lawId})`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`法令が見つかりません (law_id: ${lawId})`);
    }
    throw new Error(`e-Gov API エラー: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const data = json as EgovLawData;

  // キャッシュに保存
  lawDataCache.set(lawId, JSON.stringify(data));

  return { data, lawId, lawTitle: extractLawTitle(data) };
}

/**
 * 法令をキーワードで検索
 */
export async function searchLaws(
  keyword: string,
  limit: number = 10,
  lawType?: string
): Promise<EgovLawSearchResult[]> {
  const cacheKey = `${keyword}|${limit}|${lawType ?? ''}`;
  const cached = lawSearchCache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const params = new URLSearchParams({
    law_title: keyword,
    limit: String(limit),
    response_format: 'json',
  });
  if (lawType) {
    params.set('law_type', lawType);
  }

  await rateLimit();
  const url = `${EGOV_API_BASE}/laws?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'labor-law-mcp/0.2.0 (MCP server for Japanese labor law)',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`e-Gov API 検索タイムアウト: "${keyword}"`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`e-Gov API 検索エラー: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const results = (json.laws ?? []) as EgovLawSearchResult[];

  lawSearchCache.set(cacheKey, JSON.stringify(results));

  return results;
}

/**
 * e-Gov の法令ページURLを生成
 */
export function getEgovUrl(lawId: string): string {
  return `https://laws.e-gov.go.jp/law/${lawId}`;
}
