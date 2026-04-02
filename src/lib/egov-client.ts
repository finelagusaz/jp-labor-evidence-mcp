/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 *
 * takurot版を参考にレート制限を実装
 */

import { lawDataCache, lawSearchCache } from './cache.js';
import type { EgovLawSearchResult, EgovLawData } from './types.js';
import { isEgovLawId, resolveLawNameStrict } from './law-registry.js';
import { extractLawTitle } from './egov-parser.js';
import { ValidationError } from './errors.js';

const EGOV_API_BASE = 'https://laws.e-gov.go.jp/api/2';
const MIN_REQUEST_INTERVAL_MS = 200; // 5 req/sec (takurot版参考)
const MAX_CACHEABLE_JSON_CHARS = 500_000;

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
  const trimmed = lawNameOrId.trim();
  if (!trimmed) {
    throw new ValidationError('法令名または law_id を指定してください。');
  }

  let lawId: string;
  let lawTitleHint: string | null = null;

  if (isEgovLawId(trimmed)) {
    lawId = trimmed;
  } else {
    const { name, lawId: resolvedId } = resolveLawNameStrict(trimmed);
    if (!resolvedId) {
      throw new ValidationError(
        `法令名を厳密に特定できませんでした: "${trimmed}"。search_law で候補を確認し、正式名称または law_id を指定してください。`
      );
    }
    lawId = resolvedId;
    lawTitleHint = name;
  }

  // キャッシュチェック
  const cached = lawDataCache.get(lawId);
  if (cached) {
    const data = JSON.parse(cached) as EgovLawData;
    return { data, lawId, lawTitle: extractLawTitle(data) || lawTitleHint || lawId };
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
  const serialized = JSON.stringify(data);
  if (serialized.length <= MAX_CACHEABLE_JSON_CHARS) {
    lawDataCache.set(lawId, serialized);
  }

  return { data, lawId, lawTitle: extractLawTitle(data) || lawTitleHint || lawId };
}

/**
 * 法令をキーワードで検索
 */
export async function searchLaws(
  keyword: string,
  limit: number = 10,
  lawType?: string
): Promise<EgovLawSearchResult[]> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    throw new ValidationError('検索キーワードが空です。');
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const cacheKey = `${normalizedKeyword}|${safeLimit}|${lawType ?? ''}`;
  const cached = lawSearchCache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const params = new URLSearchParams({
    law_title: normalizedKeyword,
    limit: String(safeLimit),
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
      throw new Error(`e-Gov API 検索タイムアウト: "${normalizedKeyword}"`);
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

  const serialized = JSON.stringify(results);
  if (serialized.length <= MAX_CACHEABLE_JSON_CHARS) {
    lawSearchCache.set(cacheKey, serialized);
  }

  return results;
}

/**
 * e-Gov の法令ページURLを生成
 */
export function getEgovUrl(lawId: string): string {
  return `https://laws.e-gov.go.jp/law/${lawId}`;
}
