import { createHash } from 'node:crypto';
import type { EgovRevisionInfo, RevisionMetadata, WarningMessage } from './types.js';

export function computeUpstreamHash(parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

export function joinVersionInfo(parts: Array<string | undefined>): string | undefined {
  const values = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  if (values.length === 0) {
    return undefined;
  }
  return values.join(' / ');
}

const EGOV_LAW_DATA_API = 'https://laws.e-gov.go.jp/api/2/law_data';

/** null/空白のみ を undefined へ畳む */
function cleanValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * revision_info を Evidence 用の機械可読メタへ正規化する。
 * API 名 → 出力名の写像はここに固定（mis-map 防止）:
 *   current_enforcement_date ← amendment_enforcement_date
 *   enforcement_note         ← amendment_enforcement_comment
 * version_pinned_url は law_revision_id から導出。全フィールド欠落なら undefined。
 * 純粋関数（引数を mutate しない）。
 */
export function buildRevisionMetadata(
  revisionInfo?: EgovRevisionInfo,
): RevisionMetadata | undefined {
  if (!revisionInfo) return undefined;
  const lawRevisionId = cleanValue(revisionInfo.law_revision_id);
  const metadata: RevisionMetadata = {
    law_revision_id: lawRevisionId,
    current_enforcement_date: cleanValue(revisionInfo.amendment_enforcement_date),
    enforcement_note: cleanValue(revisionInfo.amendment_enforcement_comment),
    amendment_law_num: cleanValue(revisionInfo.amendment_law_num),
    amendment_law_title: cleanValue(revisionInfo.amendment_law_title),
    current_revision_status: cleanValue(revisionInfo.current_revision_status),
    repeal_status: cleanValue(revisionInfo.repeal_status),
    version_pinned_url: lawRevisionId
      ? `${EGOV_LAW_DATA_API}/${lawRevisionId}`
      : undefined,
  };
  const hasAny = Object.values(metadata).some((value) => value !== undefined);
  return hasAny ? metadata : undefined;
}
