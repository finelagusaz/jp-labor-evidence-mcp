import { createHash } from 'node:crypto';
import type { EgovRevisionInfo, PendingAmendment, RevisionMetadata, WarningMessage } from './types.js';
import { toJstDateString } from './indexes/time.js';
import { toWarekiDate, withWareki } from './wareki.js';
import { parseEgovLawRevisionId } from './law-registry.js';

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
 * latest_enforced_verified は照合済み（options.latestEnforcedVerified）のときだけ true、それ以外は省く。
 * 純粋関数（引数を mutate しない）。
 */
export function buildRevisionMetadata(
  revisionInfo?: EgovRevisionInfo,
  options: { latestEnforcedVerified?: boolean } = {},
): RevisionMetadata | undefined {
  if (!revisionInfo) return undefined;
  const lawRevisionId = cleanValue(revisionInfo.law_revision_id);
  const enforcementDate = cleanValue(revisionInfo.amendment_enforcement_date);
  const scheduledDate = scheduledEnforcementDateOf(revisionInfo);
  const metadata: RevisionMetadata = {
    law_revision_id: lawRevisionId,
    current_enforcement_date: enforcementDate,
    current_enforcement_date_wareki: enforcementDate && toWarekiDate(enforcementDate),
    scheduled_enforcement_date: scheduledDate,
    scheduled_enforcement_date_wareki: scheduledDate && toWarekiDate(scheduledDate),
    enforcement_note: cleanValue(revisionInfo.amendment_enforcement_comment),
    amendment_law_num: cleanValue(revisionInfo.amendment_law_num),
    amendment_law_title: cleanValue(revisionInfo.amendment_law_title),
    current_revision_status: cleanValue(revisionInfo.current_revision_status),
    repeal_status: cleanValue(revisionInfo.repeal_status),
    version_pinned_url: buildVersionPinnedUrl(revisionInfo.law_revision_id),
    latest_enforced_verified: options.latestEnforcedVerified === true ? true : undefined,
  };
  const hasAny = Object.values(metadata).some((value) => value !== undefined);
  return hasAny ? metadata : undefined;
}

/**
 * 未施行の版の施行予定日。e-Gov は未施行の版の amendment_enforcement_date を null にし、
 * 予定日を amendment_scheduled_enforcement_date にだけ入れる。
 * 施行済みの版の scheduled は「その版を生んだ改正の暫定施行日」で前方参照ではないので使わない
 */
function scheduledEnforcementDateOf(revisionInfo: EgovRevisionInfo | undefined): string | undefined {
  if (cleanValue(revisionInfo?.current_revision_status) !== 'UnEnforced') return undefined;
  return cleanValue(revisionInfo?.amendment_scheduled_enforcement_date);
}

/**
 * 人間可読 version_info を組む。既存 base（法令番号 / 公布日）を変えず、
 * 施行日セグメント＋誤帰属 hedge を append する。改正法名は載せない。
 * revision または施行日が無ければ base のみへ graceful degrade。純粋関数。
 * options.pinned: 版の ID で指定した版（diff_revision）。「現行版」ではなく「この版」と書き、
 * 未施行の版では施行予定日を書く
 */
export function buildVersionInfoString(
  lawNum: string | undefined,
  promulgationDate: string | undefined,
  revisionInfo?: EgovRevisionInfo,
  options: { pinned?: boolean } = {},
): string | undefined {
  const promulgation = cleanValue(promulgationDate);
  const base = joinVersionInfo([lawNum, promulgation && withWareki(promulgation)]);
  const enforcementDate = cleanValue(revisionInfo?.amendment_enforcement_date);
  const scheduledDate = options.pinned ? scheduledEnforcementDateOf(revisionInfo) : undefined;
  const date = enforcementDate ?? scheduledDate;
  if (!date) return base;
  const note = cleanValue(revisionInfo?.amendment_enforcement_comment);
  const noteSuffix = note ? `（施行期日規定: ${note}）` : '';
  const version = options.pinned ? 'この版' : '現行版';
  // 未施行の版は施行日の項目に日付が入っていることもある（e-Gov の版により異なる）。どちらでも予定日として書く
  const unenforced = cleanValue(revisionInfo?.current_revision_status) === 'UnEnforced';
  const kind = unenforced || !enforcementDate ? '施行予定日' : '施行日';
  const segment =
    `${version}の${kind} ${withWareki(date)}${noteSuffix}　` +
    `※この${kind}は法令全体の${version}を指し、引用した条文が改正されたとは限りません`;
  return joinVersionInfo([base, segment]);
}

/**
 * 現行施行版でない版・廃止/失効法令に対する警告を返す（入力領域に対し全域）。
 * トリガ: current_revision_status が {undefined, 'CurrentEnforced'} 以外
 *         または repeal_status が {undefined, 'None'} 以外。
 * 既知 enum は状態別文言、未知の非現行値は fail-safe の汎用文言（raw 値併記）。
 * message は lawTitle を接頭。revisionInfo 欠落・現行版時は空配列。純粋関数。
 * options.latestEnforcedVerified: isLatestEnforcedRevision で照合済みなら PreviousEnforced でも警告しない。
 */
export function getRevisionWarnings(
  revisionInfo: EgovRevisionInfo | undefined,
  lawTitle: string,
  options: { latestEnforcedVerified?: boolean } = {},
): WarningMessage[] {
  if (!revisionInfo) return [];
  const status = cleanValue(revisionInfo.current_revision_status);
  const repeal = cleanValue(revisionInfo.repeal_status);
  const repealActive = repeal !== undefined && repeal !== 'None';
  // 照合で施行済みの最新版と確認できた PreviousEnforced は e-Gov のタグ付け遅れとみなし現行扱い。
  // 廃止系の判定（repealActive）には影響させない
  const staleTag = status === 'PreviousEnforced' && options.latestEnforcedVerified === true;
  const notCurrent = status !== undefined && status !== 'CurrentEnforced' && !staleTag;
  if (!repealActive && !notCurrent) return [];

  const repealDate = cleanValue(revisionInfo.repeal_date);
  let body: string;
  if (repeal === 'Repeal' || status === 'Repeal') {
    body = `この法令は廃止されています。${repealDate ? `廃止日は ${withWareki(repealDate)}です。` : ''}現に効力を有しません。現行の法令を確認してください。`;
  } else if (repeal === 'Expire') {
    body = `この法令は期間満了により失効しています。${repealDate ? `失効日は ${withWareki(repealDate)}です。` : ''}現に効力を有しません。`;
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
 * law_data が返した版（target）が、/law_revisions の全版の中で「施行済みの最新版」かを判定する。
 * e-Gov は最新の施行版に PreviousEnforced を付けたままにすることがある（労組法・厚年法、2026-10-04 確認）。
 * /law_revisions 側でも同じ版が PreviousEnforced なので、タグではなく施行日で比べる
 * （登録 40 法令の live 調査で、施行日と未施行→施行の切り替えは正確だった）。
 *
 * true を返すのは確実に言えるときだけ。次の曖昧なケースはすべて false（＝警告を残す側）:
 * - target の law_revision_id か amendment_enforcement_date が無い
 * - target の施行日が今日（JST）より後
 * - target の law_revision_id が revisions に無い
 * - UnEnforced 以外の他の版で、施行日が無いもの・target より後のもの・target と同日のもの（順序が決まらない）がある
 * - target 以外の版が CurrentEnforced
 * 施行日は YYYY-MM-DD なので文字列比較でよい。純粋関数。
 */
export function isLatestEnforcedRevision(
  target: EgovRevisionInfo,
  revisions: EgovRevisionInfo[] | undefined,
  now: number = Date.now(),
): boolean {
  const targetId = cleanValue(target.law_revision_id);
  const targetDate = cleanValue(target.amendment_enforcement_date);
  if (!targetId || !targetDate || targetDate > toJstDateString(now)) return false;
  if (!revisions?.some((rev) => cleanValue(rev.law_revision_id) === targetId)) return false;

  return revisions.every((rev) => {
    if (cleanValue(rev.law_revision_id) === targetId) return true;
    const status = cleanValue(rev.current_revision_status);
    if (status === 'UnEnforced') return true;
    if (status === 'CurrentEnforced') return false;
    const date = cleanValue(rev.amendment_enforcement_date);
    return date !== undefined && date < targetDate;
  });
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
      enforcement_date_wareki: toWarekiDate(enforcementDate),
      amendment_law_num: cleanValue(rev.amendment_law_num),
      amendment_law_title: cleanValue(rev.amendment_law_title),
      law_revision_id: cleanValue(rev.law_revision_id),
      version_pinned_url: buildVersionPinnedUrl(rev.law_revision_id),
      enforcement_note: cleanValue(rev.amendment_enforcement_comment),
      repeal_status: cleanValue(rev.repeal_status),
      amendment_law_id: amendmentLawIdOf(rev),
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
  return { amendments: withPhases(amendments), excludedCount };
}

/** 改正法の law_id。/law_revisions の amendment_law_id を使い、無ければ版の ID の末尾 15 文字から読む */
function amendmentLawIdOf(rev: EgovRevisionInfo): string | undefined {
  const id = cleanValue(rev.amendment_law_id);
  if (id) return id;
  const revisionId = cleanValue(rev.law_revision_id);
  return revisionId ? parseEgovLawRevisionId(revisionId)?.amendmentLawId : undefined;
}

/**
 * 同じ改正法の未施行の版が複数ある（段階施行）とき、施行予定日の早い順に phase / phase_count を付ける。
 * amendments は施行予定日の昇順で受け取る。改正法の分からない版はまとめない
 */
function withPhases(amendments: PendingAmendment[]): PendingAmendment[] {
  const counts = new Map<string, number>();
  for (const a of amendments) {
    if (a.amendment_law_id) counts.set(a.amendment_law_id, (counts.get(a.amendment_law_id) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return amendments.map((a) => {
    const count = a.amendment_law_id ? counts.get(a.amendment_law_id)! : 1;
    if (count < 2) return a;
    const phase = (seen.get(a.amendment_law_id!) ?? 0) + 1;
    seen.set(a.amendment_law_id!, phase);
    return { ...a, phase, phase_count: count };
  });
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
    // 段階施行（同じ改正法の版が複数）があれば改正法の本数を添える。改正法の分からない版は 1 本と数える
    const amendOnly = amendments.filter((a) => a.repeal_status === undefined || a.repeal_status === 'None');
    const lawCount = new Set(amendOnly.map((a, i) => a.amendment_law_id ?? `#${i}`)).size;
    const lawNote = lawCount < amendCount ? `（改正法 ${lawCount} 本。段階施行を含む）` : '';
    const parts: string[] = [];
    if (amendCount > 0) parts.push(`未施行の改正が ${amendCount} 件${lawNote}`);
    if (repealCount > 0) parts.push(`廃止予定が ${repealCount} 件`);
    warnings.push({
      code: 'UNENFORCED_AMENDMENT_PENDING',
      message:
        `${lawTitle}: 現行施行版に対し、${parts.join('・')}予定されています。最も近い施行予定日は ${withWareki(nearest)}です。` +
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
