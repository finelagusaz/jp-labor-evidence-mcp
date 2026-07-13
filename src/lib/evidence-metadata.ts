import { createHash } from 'node:crypto';
import type { EgovRevisionInfo, PendingAmendment, RevisionMetadata, WarningMessage } from './types.js';

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

/** law_revision_id から版固定 URL（/api/2/law_data/{id}）を導出。純粋。 */
export function buildVersionPinnedUrl(lawRevisionId: string | null | undefined): string | undefined {
  const id = cleanValue(lawRevisionId);
  return id ? `${EGOV_LAW_DATA_API}/${id}` : undefined;
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
    version_pinned_url: buildVersionPinnedUrl(revisionInfo.law_revision_id),
  };
  const hasAny = Object.values(metadata).some((value) => value !== undefined);
  return hasAny ? metadata : undefined;
}

/**
 * 人間可読 version_info を組む。既存 base（法令番号 / 公布日）を変えず、
 * 現行版の施行日セグメント＋誤帰属 hedge を append する。改正法名は載せない。
 * revision または施行日が無ければ base のみへ graceful degrade。純粋関数。
 */
export function buildVersionInfoString(
  lawNum: string | undefined,
  promulgationDate: string | undefined,
  revisionInfo?: EgovRevisionInfo,
): string | undefined {
  const base = joinVersionInfo([lawNum, promulgationDate]);
  const enforcementDate = cleanValue(revisionInfo?.amendment_enforcement_date);
  if (!enforcementDate) return base;
  const note = cleanValue(revisionInfo?.amendment_enforcement_comment);
  const noteSuffix = note ? `（施行期日規定: ${note}）` : '';
  const segment =
    `現行版の施行日 ${enforcementDate}${noteSuffix}　` +
    '※この施行日は法令全体の現行版を指し、引用した条文が改正されたとは限りません';
  return joinVersionInfo([base, segment]);
}

/**
 * 現行施行版でない版・廃止/失効法令に対する警告を返す（入力領域に対し全域）。
 * トリガ: current_revision_status が {undefined, 'CurrentEnforced'} 以外
 *         または repeal_status が {undefined, 'None'} 以外。
 * 既知 enum は状態別文言、未知の非現行値は fail-safe の汎用文言（raw 値併記）。
 * message は lawTitle を接頭。revisionInfo 欠落・現行版時は空配列。純粋関数。
 */
export function getRevisionWarnings(
  revisionInfo: EgovRevisionInfo | undefined,
  lawTitle: string,
): WarningMessage[] {
  if (!revisionInfo) return [];
  const status = cleanValue(revisionInfo.current_revision_status);
  const repeal = cleanValue(revisionInfo.repeal_status);
  const repealActive = repeal !== undefined && repeal !== 'None';
  const notCurrent = status !== undefined && status !== 'CurrentEnforced';
  if (!repealActive && !notCurrent) return [];

  const repealDate = cleanValue(revisionInfo.repeal_date);
  let body: string;
  if (repeal === 'Repeal' || status === 'Repeal') {
    body = `この法令は廃止されています${repealDate ? `（廃止日: ${repealDate}）` : ''}。現に効力を有しません。現行の法令を確認してください。`;
  } else if (repeal === 'Expire') {
    body = `この法令は期間満了により失効しています${repealDate ? `（失効日: ${repealDate}）` : ''}。現に効力を有しません。`;
  } else if (repeal === 'LossOfEffectiveness') {
    body = 'この法令は効力を喪失しています。現に効力を有しません。';
  } else if (repeal === 'Suspend') {
    body = 'この法令は効力が停止されています。適用の可否を確認してください。';
  } else if (status === 'UnEnforced') {
    body = 'この版はまだ施行されていません（未施行）。現在の施行版とは内容が異なる可能性があります。';
  } else if (status === 'PreviousEnforced') {
    body = 'この版は過去の施行版であり、現行版ではありません。より新しい施行版が存在します。';
  } else {
    const rawState = repealActive ? repeal : status;
    body = `この法令は現行施行版ではない可能性があります（状態: ${rawState}）。現行の法令を確認してください。`;
  }
  return [{ code: 'LAW_NOT_CURRENTLY_ENFORCED', message: `${lawTitle}: ${body}` }];
}

/**
 * /law_revisions の revisions から未施行改正（UnEnforced）を抽出し、
 * (enforcement_date, law_revision_id) 昇順の PendingAmendment[] を返す。
 * enforcement_date を持たない版は除外し excludedCount で数える。純粋（入力を mutate しない）。
 */
export function buildPendingAmendments(
  revisions: EgovRevisionInfo[] | undefined,
): { amendments: PendingAmendment[]; excludedCount: number } {
  if (!revisions) return { amendments: [], excludedCount: 0 };
  let excludedCount = 0;
  const amendments: PendingAmendment[] = [];
  for (const rev of revisions) {
    if (cleanValue(rev.current_revision_status) !== 'UnEnforced') continue;
    const enforcementDate = cleanValue(rev.amendment_enforcement_date);
    if (!enforcementDate) {
      excludedCount += 1;
      continue;
    }
    amendments.push({
      enforcement_date: enforcementDate,
      amendment_law_num: cleanValue(rev.amendment_law_num),
      amendment_law_title: cleanValue(rev.amendment_law_title),
      law_revision_id: cleanValue(rev.law_revision_id),
      version_pinned_url: buildVersionPinnedUrl(rev.law_revision_id),
      enforcement_note: cleanValue(rev.amendment_enforcement_comment),
      repeal_status: cleanValue(rev.repeal_status),
    });
  }
  amendments.sort((a, b) => {
    if (a.enforcement_date !== b.enforcement_date) {
      return a.enforcement_date < b.enforcement_date ? -1 : 1;
    }
    const ra = a.law_revision_id ?? '';
    const rb = b.law_revision_id ?? '';
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  return { amendments, excludedCount };
}

/**
 * 未施行改正の警告を返す（法令名接頭・誤帰属 hedge・改正/廃止分割・fail-safe）。純粋。
 * - amendments が1件以上 → UNENFORCED_AMENDMENT_PENDING（最も近い施行予定日は min で防御的）。
 * - excludedCount > 0 → PENDING_AMENDMENT_INCOMPLETE_DATA。
 */
export function getPendingAmendmentWarnings(
  built: { amendments: PendingAmendment[]; excludedCount: number },
  lawTitle: string,
): WarningMessage[] {
  const warnings: WarningMessage[] = [];
  const { amendments, excludedCount } = built;
  if (amendments.length > 0) {
    const repealCount = amendments.filter(
      (a) => a.repeal_status !== undefined && a.repeal_status !== 'None',
    ).length;
    const amendCount = amendments.length - repealCount;
    const nearest = amendments.reduce(
      (min, a) => (a.enforcement_date < min ? a.enforcement_date : min),
      amendments[0].enforcement_date,
    );
    const parts: string[] = [];
    if (amendCount > 0) parts.push(`未施行の改正が ${amendCount} 件`);
    if (repealCount > 0) parts.push(`廃止予定が ${repealCount} 件`);
    warnings.push({
      code: 'UNENFORCED_AMENDMENT_PENDING',
      message:
        `${lawTitle}: 現行施行版に対し、${parts.join('・')}予定されています（最も近い施行予定日 ${nearest}）。` +
        '※これは法令全体の改正予定であり、引用した条文が改正対象に含まれるとは限りません。' +
        '詳細は pending_amendments を参照してください。',
    });
  }
  if (excludedCount > 0) {
    warnings.push({
      code: 'PENDING_AMENDMENT_INCOMPLETE_DATA',
      message: `${lawTitle}: 一部の未施行改正で施行予定日が取得できませんでした（${excludedCount} 件）。`,
    });
  }
  return warnings;
}
