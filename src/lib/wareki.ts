/**
 * ISO の日付（`YYYY-MM-DD`）を和暦（「令和8年6月24日」）にする。
 *
 * 元号は年ではなく改元の日で切り替わる（例: 2019-04-30 は平成31年、2019-05-01 は令和元年）。
 * e-Gov の日付は ISO の暦日なので、改元日の ISO 文字列との辞書順比較で元号を選ぶ。
 */

import { ERA_BASE_YEAR } from './law-num.js';

/** 改元日の新しい順。明治は太陽暦の採用日（明治6年1月1日）から */
const ERA_STARTS: ReadonlyArray<readonly [era: string, start: string]> = [
  ['令和', '2019-05-01'],
  ['平成', '1989-01-08'],
  ['昭和', '1926-12-25'],
  ['大正', '1912-07-30'],
  ['明治', '1873-01-01'],
];

/**
 * 和暦の日付を返す。年が 1 なら「元年」。
 * 形式が違う・実在しない日付・太陽暦の採用前（1873-01-01 より前。旧暦の日付とずれる）は undefined
 */
export function toWarekiDate(iso: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  const normalized = `${m[1]}-${m[2]}-${m[3]}`;
  const era = ERA_STARTS.find(([, start]) => normalized >= start)?.[0];
  if (era === undefined) return undefined;
  const eraYear = year - ERA_BASE_YEAR[era] + 1;
  return `${era}${eraYear === 1 ? '元' : eraYear}年${month}月${day}日`;
}

/** 「2026-06-24（令和8年6月24日）」。和暦にできなければ元の文字列のまま */
export function withWareki(iso: string): string {
  const wareki = toWarekiDate(iso);
  return wareki ? `${iso}（${wareki}）` : iso;
}
