/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 */

import type { EgovLawSearchResult, EgovLawData, EgovLawRevisionsResponse } from './types.js';
import { isEgovLawId, parseEgovLawRevisionId, resolveLawNameStrict } from './law-registry.js';
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
  /** 版の ID（law_revision_id）で指定されたときだけ */
  lawRevisionId?: string;
}> {
  const trimmed = lawNameOrId.trim();
  if (!trimmed) {
    throw new ValidationError('法令名または law_id を指定してください。');
  }

  // 版の ID なら、その版を取る。law_id は版の ID から取り出したものを使う
  const revision = parseEgovLawRevisionId(trimmed);
  if (revision) {
    const data = await egovSourceAdapter.fetchLawDataById(revision.lawRevisionId);
    return {
      data,
      lawId: revision.lawId,
      lawTitle: extractLawTitle(data) || revision.lawId,
      lawRevisionId: revision.lawRevisionId,
    };
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
 * 確定済み law_id の法令履歴一覧（/law_revisions）を取得
 */
export async function fetchLawRevisions(lawId: string): Promise<EgovLawRevisionsResponse> {
  const trimmed = lawId.trim();
  if (!trimmed) {
    throw new ValidationError('law_id を指定してください。');
  }
  return await egovSourceAdapter.fetchLawRevisions(trimmed);
}

/**
 * e-Gov の法令ページURLを生成
 */
export function getEgovUrl(lawId: string, lawRevisionId?: string): string {
  // 版のページは /law/{law_id}/{施行日}_{改正法 ID}（2026-10-08 にブラウザで版の本文が出ることを確認）
  const revision = lawRevisionId ? parseEgovLawRevisionId(lawRevisionId) : undefined;
  return revision
    ? `https://laws.e-gov.go.jp/law/${revision.lawId}/${revision.date}_${revision.amendmentLawId}`
    : `https://laws.e-gov.go.jp/law/${lawId}`;
}
