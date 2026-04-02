/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 */

import type { EgovLawSearchResult, EgovLawData } from './types.js';
import { isEgovLawId, resolveLawNameStrict } from './law-registry.js';
import { extractLawTitle } from './egov-parser.js';
import { ValidationError } from './errors.js';
import { egovSourceAdapter } from './source-adapters/egov-source-adapter.js';

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

  const data = await egovSourceAdapter.fetchLawDataById(lawId);
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
  return await egovSourceAdapter.searchLaws(normalizedKeyword, safeLimit, lawType);
}

/**
 * e-Gov の法令ページURLを生成
 */
export function getEgovUrl(lawId: string): string {
  return `https://laws.e-gov.go.jp/law/${lawId}`;
}
