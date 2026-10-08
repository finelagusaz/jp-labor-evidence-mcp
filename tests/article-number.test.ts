import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractArticle, normalizeArticleNum } from '../src/lib/egov-parser.js';
import { articleKeyOf, formatArticleLabel } from '../src/lib/article-locator.js';
import { toKanjiNumeral } from '../src/lib/law-num.js';

const roki = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/egov/suppl-roki.json', import.meta.url)), 'utf8'));

describe('normalizeArticleNum', () => {
  it.each([
    ['32', '32'],
    ['32の2', '32_2'],
    ['32_2', '32_2'],
    ['32-2', '32_2'],
    ['第32条', '32'],
    // 法令の正しい表記。以前は「条」以降を捨てて 32（第32条）に化けていた
    ['第32条の2', '32_2'],
    ['32条の2', '32_2'],
    ['第32条の3の2', '32_3_2'],
    ['第三十二条の二', '32_2'],
    ['三十二', '32'],
    ['１２', '12'],
    ['第32条第1項', '32'],
    ['第32条の2第1項', '32_2'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeArticleNum(input)).toBe(expected);
  });

  it('範囲の Num（まとめて削除された条）は従来どおり', () => {
    expect(normalizeArticleNum('4:5')).toBe('4:5');
  });
});

describe('extractArticle: 条番号の書き方', () => {
  it.each(['32の2', '第32条の2', '32条の2', '第三十二条の二'])('%s は第32条の2 を返す（第32条に化けない）', (input) => {
    expect(extractArticle(roki, input)?.text).toContain('**第三十二条の二**');
  });
});

describe('条番号の表記', () => {
  it.each([
    ['32', '第32条'],
    ['32の2', '第32条の2'],
    ['第32条の2', '第32条の2'],
    ['第三十二条の二', '第32条の2'],
    ['32_3_2', '第32条の3の2'],
    ['第36条', '第36条'],
  ])('formatArticleLabel(%s) → %s', (input, expected) => {
    expect(formatArticleLabel(input)).toBe(expected);
  });

  it('漢数字の表記（通達の書き方）', () => {
    expect(formatArticleLabel('32の2', { kanji: true })).toBe('第三十二条の二');
    expect(formatArticleLabel('120', { kanji: true })).toBe('第百二十条');
  });

  it.each([
    ['32の2', '32の2'],
    ['第32条の2', '32の2'],
    ['第三十二条の二', '32の2'],
    ['第36条', '36'],
    ['36', '36'],
  ])('articleKeyOf(%s) → %s（canonical_id 用の正規形）', (input, expected) => {
    expect(articleKeyOf(input)).toBe(expected);
  });

  it.each([
    [1, '一'], [10, '十'], [12, '十二'], [20, '二十'], [32, '三十二'], [100, '百'], [102, '百二'], [120, '百二十'], [1947, '千九百四十七'],
  ])('toKanjiNumeral(%d) → %s', (n, expected) => {
    expect(toKanjiNumeral(n)).toBe(expected);
  });
});
