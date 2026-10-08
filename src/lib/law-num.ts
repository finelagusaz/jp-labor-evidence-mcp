/**
 * 法令番号（「令和八年法律第四十六号」等）の解析と正規化。
 *
 * e-Gov には 2 つの書き方がある:
 * - /law_data の SupplProvision@AmendLawNum: 「令和八年六月二四日法律第四六号」（位取りの漢数字・公布日つき）
 * - /law_revisions の amendment_law_num: 「令和八年法律第四十六号」（十を使う漢数字・日付なし）
 * どちらも同じ正規形（suppl key）「令和8年法律第46号」に寄せる。
 */

export interface ParsedLawNum {
  era: string;
  year: number;
  kind?: string;
  number?: number;
  month?: number;
  day?: number;
  /** 公布日の年が法令番号の年と食い違うときだけ（例: 平成12年公布の平成13年厚生労働省令） */
  promulgatedEra?: string;
  promulgatedYear?: number;
}

const DIGITS: Record<string, number> = {
  '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};
const UNITS: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };

/**
 * 漢数字・算用数字を数値にする。十・百・千を含めば十を使う形、含まなければ位取りとして読む。
 * 変換できなければ undefined（例外は投げない）。
 */
export function kanjiToNumber(input: string): number | undefined {
  const s = input.normalize('NFKC').trim();
  if (!s) return undefined;
  if (s === '元') return 1;
  if (/^\d+$/.test(s)) return Number(s);

  if (/[十百千]/.test(s)) {
    let total = 0;
    let digit: number | undefined;
    let lastUnit = Infinity;
    for (const ch of s) {
      if (ch in DIGITS) {
        if (digit !== undefined) return undefined;
        digit = DIGITS[ch];
      } else if (ch in UNITS) {
        const unit = UNITS[ch];
        if (unit >= lastUnit) return undefined;
        total += (digit ?? 1) * unit;
        digit = undefined;
        lastUnit = unit;
      } else {
        return undefined;
      }
    }
    return total + (digit ?? 0);
  }

  let value = 0;
  for (const ch of s) {
    if (!(ch in DIGITS)) return undefined;
    value = value * 10 + DIGITS[ch];
  }
  return value;
}

const ERA = '(明治|大正|昭和|平成|令和)';
const NUM = '([〇一二三四五六七八九十百千元\\d]+)';
const PROMULGATION_PREFIX = new RegExp(`^${ERA}${NUM}年${NUM}月${NUM}日`);
const LAW_NUM = new RegExp(`^${ERA}${NUM}年(?:(.*?)?第${NUM}号)?$`);

/**
 * 法令番号を解析する。年だけ（「令和8年」）や種別の省略（「令和8年第46号」）も受け付ける。
 * 公布日の接頭辞があれば取り除き、年は法令番号の側から取る。解析できなければ undefined。
 */
export function parseLawNum(input: string): ParsedLawNum | undefined {
  let s = input.normalize('NFKC').replace(/\s+/g, '');
  if (!s) return undefined;

  let month: number | undefined;
  let day: number | undefined;
  let promulgatedEra: string | undefined;
  let promulgatedYear: number | undefined;
  const prefix = PROMULGATION_PREFIX.exec(s);
  if (prefix) {
    const rest = s.slice(prefix[0].length);
    month = kanjiToNumber(prefix[3]);
    day = kanjiToNumber(prefix[4]);
    if (month === undefined || day === undefined) return undefined;
    if (new RegExp(`^${ERA}`).test(rest)) {
      // 「平成一二年八月一四日 平成一三年厚生労働省令第二号」: 年は後ろの法令番号から取る
      promulgatedEra = prefix[1];
      promulgatedYear = kanjiToNumber(prefix[2]);
      s = rest;
    } else {
      s = `${prefix[1]}${prefix[2]}年${rest}`;
    }
  }

  const m = LAW_NUM.exec(s);
  if (!m) return undefined;
  const year = kanjiToNumber(m[2]);
  if (year === undefined || year < 1) return undefined;

  const parsed: ParsedLawNum = { era: m[1], year };
  const kind = m[3]?.trim();
  if (kind) parsed.kind = kind;
  if (m[4] !== undefined) {
    const number = kanjiToNumber(m[4]);
    if (number === undefined) return undefined;
    parsed.number = number;
  }
  if (month !== undefined && day !== undefined) {
    parsed.month = month;
    parsed.day = day;
  }
  if (promulgatedEra !== undefined && promulgatedYear !== undefined) {
    parsed.promulgatedEra = promulgatedEra;
    parsed.promulgatedYear = promulgatedYear;
  }
  return parsed;
}

/** 附則の正規形（suppl key）。「令和8年法律第46号」、年が 1 なら「平成元年…」 */
export function formatSupplKey(parsed: ParsedLawNum): string {
  const year = parsed.year === 1 ? '元' : String(parsed.year);
  const tail = parsed.number !== undefined ? `${parsed.kind ?? ''}第${parsed.number}号` : '';
  return `${parsed.era}${year}年${tail}`;
}

/** query（入力）が target（附則の法令番号）に一致するか。query に無い種別・番号は問わない */
export function lawNumMatches(query: ParsedLawNum, target: ParsedLawNum): boolean {
  if (query.era !== target.era || query.year !== target.year) return false;
  if (query.kind !== undefined && query.kind !== target.kind) return false;
  if (query.number !== undefined && query.number !== target.number) return false;
  return true;
}

const ERA_BASE_YEAR: Record<string, number> = { 明治: 1868, 大正: 1912, 昭和: 1926, 平成: 1989, 令和: 2019 };

/**
 * 公布日の並べ替え用の数値（YYYYMMDD）。公布日の年が番号の年と食い違うときは公布日の年を使う。
 * 公布日が無ければ undefined
 */
export function promulgationSortKey(parsed: ParsedLawNum): number | undefined {
  if (parsed.month === undefined || parsed.day === undefined) return undefined;
  const era = parsed.promulgatedEra ?? parsed.era;
  const year = parsed.promulgatedYear ?? parsed.year;
  const base = ERA_BASE_YEAR[era];
  if (base === undefined) return undefined;
  return (base + year - 1) * 10000 + parsed.month * 100 + parsed.day;
}

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 数を法令の漢数字（十・百・千を使う形）にする。32 → 三十二、102 → 百二、1947 → 千九百四十七。
 * 通達の条番号（「第三十二条の二」）との照合に使う。1〜9999 以外は算用数字のまま返す
 */
export function toKanjiNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) return String(n);
  let out = '';
  for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十']] as const) {
    const digit = Math.floor(n / unit) % 10;
    if (digit > 0) out += `${digit === 1 ? '' : KANJI_DIGITS[digit]}${label}`;
  }
  const ones = n % 10;
  return ones > 0 ? out + KANJI_DIGITS[ones] : out;
}

