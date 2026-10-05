import { describe, expect, it } from 'vitest';
import { formatSupplKey, kanjiToNumber, lawNumMatches, parseLawNum } from '../src/lib/law-num.js';

describe('kanjiToNumber', () => {
  it.each([
    ['四十六', 46],
    ['四六', 46],
    ['二十', 20],
    ['十', 10],
    ['百二', 102],
    ['千九百四十七', 1947],
    ['一〇', 10],
    ['二〇四', 204],
    ['元', 1],
    ['46', 46],
    ['４６', 46],
  ])('%s → %d', (input, expected) => {
    expect(kanjiToNumber(input)).toBe(expected);
  });

  it.each(['一及び二', '一から三まで', '', 'イ', '十十'])('%s は undefined', (input) => {
    expect(kanjiToNumber(input)).toBeUndefined();
  });
});

describe('parseLawNum', () => {
  it('e-Gov の AmendLawNum（位取り・公布日つき）', () => {
    expect(parseLawNum('令和八年六月二四日法律第四六号')).toEqual({
      era: '令和', year: 8, kind: '法律', number: 46, month: 6, day: 24,
    });
  });

  it('/law_revisions の amendment_law_num（十つき・日付なし）', () => {
    expect(parseLawNum('令和八年法律第四十六号')).toEqual({ era: '令和', year: 8, kind: '法律', number: 46 });
  });

  it('算用数字・全角・空白', () => {
    expect(parseLawNum('令和8年法律第46号')).toEqual({ era: '令和', year: 8, kind: '法律', number: 46 });
    expect(parseLawNum(' 令和８年 法律 第４６号 ')).toEqual({ era: '令和', year: 8, kind: '法律', number: 46 });
  });

  it('元年', () => {
    expect(parseLawNum('平成元年二月一〇日労働省令第一号')).toMatchObject({ era: '平成', year: 1, kind: '労働省令', number: 1 });
  });

  it('公布日の年と法令番号の年が食い違うときは法令番号の年を取る', () => {
    expect(parseLawNum('平成一二年八月一四日　平成一三年厚生労働省令第二号')).toEqual({
      era: '平成', year: 13, kind: '厚生労働省令', number: 2, month: 8, day: 14, promulgatedYear: 12, promulgatedEra: '平成',
    });
  });

  it('種別に記号を含むもの', () => {
    expect(parseLawNum('昭和四三年一一月二八日厚生省・労働省令第一号')).toMatchObject({ kind: '厚生省・労働省令', number: 1 });
  });

  it('種別・番号の省略', () => {
    expect(parseLawNum('令和8年第46号')).toEqual({ era: '令和', year: 8, number: 46 });
    expect(parseLawNum('令和8年')).toEqual({ era: '令和', year: 8 });
    expect(parseLawNum('令和八年')).toEqual({ era: '令和', year: 8 });
  });

  it.each(['', '法律第46号', '2026年法律第46号', '令和年法律第46号', 'abc'])('%s は undefined', (input) => {
    expect(parseLawNum(input)).toBeUndefined();
  });
});

describe('formatSupplKey', () => {
  it('算用数字・公布日なし', () => {
    expect(formatSupplKey(parseLawNum('令和八年六月二四日法律第四六号')!)).toBe('令和8年法律第46号');
  });

  it('年が 1 なら元年', () => {
    expect(formatSupplKey(parseLawNum('平成元年二月一〇日労働省令第一号')!)).toBe('平成元年労働省令第1号');
  });
});

describe('lawNumMatches', () => {
  const target = parseLawNum('令和八年六月二四日法律第四六号')!;

  it('2 つの表記が一致する', () => {
    expect(lawNumMatches(parseLawNum('令和八年法律第四十六号')!, target)).toBe(true);
  });

  it('種別が書かれていれば一致を要求する', () => {
    expect(lawNumMatches(parseLawNum('令和8年政令第46号')!, target)).toBe(false);
    expect(lawNumMatches(parseLawNum('令和8年第46号')!, target)).toBe(true);
  });

  it('年だけなら年で一致する', () => {
    expect(lawNumMatches(parseLawNum('令和8年')!, target)).toBe(true);
    expect(lawNumMatches(parseLawNum('令和7年')!, target)).toBe(false);
  });

  it('番号・元号の不一致', () => {
    expect(lawNumMatches(parseLawNum('令和8年法律第47号')!, target)).toBe(false);
    expect(lawNumMatches(parseLawNum('平成8年法律第46号')!, target)).toBe(false);
  });
});
