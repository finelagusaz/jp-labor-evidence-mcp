import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractArticle,
  extractSupplProvision,
  listSupplProvisions,
  normalizeItemNum,
  formatArticleBody,
  normalizeArticleCaption,
  normalizeSubitemPath,
  selectSupplProvision,
} from '../src/lib/egov-parser.js';
import { ValidationError } from '../src/lib/errors.js';
import type { EgovLawData } from '../src/lib/types.js';

const fixture = (name: string): EgovLawData =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8'));

// live の労基則から切り出したもの: 本則 第5条・第7条の2、附則 4 件（制定時・平成元年・平成13年・令和8年）
const rokiso = fixture('suppl-subitem-rokiso.json');
// live の労基法から切り出したもの: 附則 3 件（制定時・昭和27年法律第287号（条なし）・令和8年法律第60号）
const roki = fixture('suppl-roki.json');

describe('normalizeItemNum', () => {
  it.each([
    [3, '3'],
    ['3', '3'],
    ['3の2', '3_2'],
    ['3_2', '3_2'],
    ['三の二', '3_2'],
    ['六', '6'],
    ['十二の五の二', '12_5_2'],
    ['第3号', '3'],
    ['第三号の二', '3_2'],
    ['１', '1'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeItemNum(input)).toBe(expected);
  });

  it.each(['', 'イ', '一及び二'])('%s は undefined', (input) => {
    expect(normalizeItemNum(input)).toBeUndefined();
  });
});

describe('normalizeSubitemPath', () => {
  it.each([
    ['イ', ['イ']],
    ['イ (1)', ['イ', '1']],
    ['イ-(1)-(i)', ['イ', '1', 'i']],
    ['イ（１）（ｉ）', ['イ', '1', 'i']],
    ['ロ(1)(iii)', ['ロ', '1', 'iii']],
    ['イ/1/i', ['イ', '1', 'i']],
  ])('%s → %j', (input, expected) => {
    expect(normalizeSubitemPath(input)).toEqual(expected);
  });
});

describe('extractArticle: 号と細分', () => {
  it('枝番号の号を文字列で指定できる', () => {
    const r = extractArticle(rokiso, '5', 1, '1の2');
    expect(r?.text).toMatch(/^一の二/);
  });

  it('漢数字の号を指定できる', () => {
    expect(extractArticle(rokiso, '5', 1, '六')?.text).toMatch(/^六/);
  });

  it('数値の号はこれまでどおり', () => {
    expect(extractArticle(rokiso, '5', 1, 6)?.text).toMatch(/^六/);
  });

  it('paragraph を省いた号: 一致する項が 1 つなら、その項を使い matchedParagraph を返す', () => {
    const r = extractArticle(rokiso, '5', undefined, '1の2');
    expect(r?.matchedParagraph).toBe(1);
    expect(r?.text).toMatch(/^一の二/);
  });

  it('paragraph を省いた号: 複数の項に一致したら ValidationError で項を示す', () => {
    expect(() => extractArticle(rokiso, '5', undefined, 2)).toThrow(ValidationError);
    expect(() => extractArticle(rokiso, '5', undefined, 2)).toThrow(/第1項.*第4項/);
  });

  it('paragraph を省いた号: どの項にも無ければ null', () => {
    expect(extractArticle(rokiso, '5', undefined, 99)).toBeNull();
  });

  it('細分を深さ 3 までたどる（全角の見出し・Num のどちらでも）', () => {
    const r = extractArticle(rokiso, '7の2', 1, 2, 'ロ (1) (iii)');
    expect(r?.text).toMatch(/^（ｉｉｉ）/);
    expect(extractArticle(rokiso, '7の2', 1, 2, 'ロ/1/3')?.text).toBe(r?.text);
  });

  it('号の番号だけでは複数の項に一致しても、細分まで含めて 1 つに決まれば一意', () => {
    const r = extractArticle(rokiso, '7の2', undefined, 2, 'ロ（１）');
    expect(r?.matchedParagraph).toBe(1);
    expect(r?.text).toMatch(/^（１）/);
  });

  it('細分が見つからなければ null', () => {
    expect(extractArticle(rokiso, '7の2', 1, 2, 'ヲ')).toBeNull();
  });
});

describe('listSupplProvisions', () => {
  it('e-Gov の並びで key・抄・条・項を返す', () => {
    const list = listSupplProvisions(rokiso);
    expect(list.map((s) => s.key)).toEqual([
      '制定',
      '平成元年労働省令第1号',
      '平成13年厚生労働省令第2号',
      '令和8年厚生労働省令第57号',
    ]);
    expect(list[0]).toMatchObject({ amendLawNum: undefined, extract: true });
    expect(list[0]?.articleNums.slice(0, 2)).toEqual(['60', '63']);
    expect(list[1]).toMatchObject({ amendLawNum: '平成元年二月一〇日労働省令第一号', extract: false, articleNums: [], paragraphCount: 2 });
  });
});

describe('selectSupplProvision', () => {
  it('制定 / 制定時', () => {
    expect(selectSupplProvision(rokiso, '制定')?.key).toBe('制定');
    expect(selectSupplProvision(rokiso, '制定時')?.key).toBe('制定');
  });

  it('2 つの表記・算用数字・元年', () => {
    expect(selectSupplProvision(rokiso, '令和八年三月三一日厚生労働省令第五七号')?.key).toBe('令和8年厚生労働省令第57号');
    expect(selectSupplProvision(rokiso, '令和八年厚生労働省令第五十七号')?.key).toBe('令和8年厚生労働省令第57号');
    expect(selectSupplProvision(rokiso, '平成1年労働省令第1号')?.key).toBe('平成元年労働省令第1号');
  });

  it('公布日と番号の年が食い違う附則は番号の年で引ける', () => {
    expect(selectSupplProvision(rokiso, '平成13年厚生労働省令第2号')?.key).toBe('平成13年厚生労働省令第2号');
  });

  it('該当なしは null', () => {
    expect(selectSupplProvision(rokiso, '令和8年厚生労働省令第1号')).toBeNull();
  });

  it('番号が無い・解析できない入力は ValidationError', () => {
    expect(() => selectSupplProvision(rokiso, '令和8年')).toThrow(ValidationError);
    expect(() => selectSupplProvision(rokiso, 'あいう')).toThrow(ValidationError);
  });

  it('複数に一致したら ValidationError で候補を示す', () => {
    const dup = structuredClone(rokiso);
    const body = (dup.law_full_text.children ?? []).find((c) => typeof c !== 'string' && c.tag === 'LawBody') as any;
    const last = body.children.filter((c: any) => c.tag === 'SupplProvision').at(-1);
    body.children.push({ ...last, attr: { ...last.attr, AmendLawNum: '令和八年三月三一日政令第五七号' } });
    expect(() => selectSupplProvision(dup, '令和8年第57号')).toThrow(/令和8年厚生労働省令第57号.*令和8年政令第57号/);
    expect(selectSupplProvision(dup, '令和8年政令第57号')?.key).toBe('令和8年政令第57号');
  });
});

describe('extractSupplProvision', () => {
  const pick = (law: EgovLawData, query: string) => selectSupplProvision(law, query)!;

  it('附則の条', () => {
    const r = extractSupplProvision(roki, pick(roki, '令和8年法律第60号'), { article: '1' });
    expect(r?.text).toContain('第一条');
  });

  it('条を持たない附則: ブロック全体', () => {
    const r = extractSupplProvision(roki, pick(roki, '昭和27年法律第287号'), {});
    expect(r?.text).toContain('昭和二十七年九月一日から施行する');
    expect(r?.text).toContain('常時百人未満');
  });

  it('条を持たない附則: 項・号を直接指定できる', () => {
    const law = pick(roki, '昭和27年法律第287号');
    expect(extractSupplProvision(roki, law, { paragraph: 1 })?.text).toContain('昭和二十七年九月一日から施行する');
    expect(extractSupplProvision(roki, law, { paragraph: 4, item: 4 })?.text).toMatch(/^四 常時百人未満/);
    const r = extractSupplProvision(roki, law, { item: '五' });
    expect(r?.matchedParagraph).toBe(4);
  });

  it('条を持つ附則で article を省いて paragraph を指定したら ValidationError', () => {
    expect(() => extractSupplProvision(roki, pick(roki, '令和8年法律第60号'), { paragraph: 1 })).toThrow(/article/);
  });

  it('附則に無い条は null', () => {
    expect(extractSupplProvision(roki, pick(roki, '令和8年法律第60号'), { article: '99' })).toBeNull();
  });

  it('附則第1条と本則第1条を取り違えない', () => {
    const suppl = extractSupplProvision(rokiso, pick(rokiso, '令和8年厚生労働省令第57号'), { article: '1' });
    expect(suppl?.text).not.toBe(extractArticle(roki, '1')?.text);
    expect(suppl?.text).toContain('施行');
  });
});

describe('条見出し', () => {
  it('e-Gov の ArticleCaption（括弧つき）から外側の括弧を外して返す', () => {
    expect(extractArticle(roki, '32')?.articleCaption).toBe('労働時間');
  });

  it('条全体のときだけ本文に条見出しの行が入る（captionInText）', () => {
    const whole = extractArticle(roki, '32')!;
    expect(whole.captionInText).toBe(true);
    expect(whole.text).toContain('#### （労働時間）');
    const para = extractArticle(roki, '32', 1)!;
    expect(para.captionInText).toBe(false);
    expect(para.text).not.toContain('労働時間）');
  });

  it('formatArticleBody: 条全体なら本文のまま、項以下なら先頭に条見出しを 1 行足す', () => {
    expect(formatArticleBody({ articleCaption: '労働時間', text: '#### （労働時間）\n本文', captionInText: true })).toBe('#### （労働時間）\n本文');
    expect(formatArticleBody({ articleCaption: '労働時間', text: '本文', captionInText: false })).toBe('（労働時間）\n本文');
    expect(formatArticleBody({ articleCaption: '', text: '本文', captionInText: false })).toBe('本文');
    // captionInText を持たない（古い形の）結果は先頭に足す側に倒す
    expect(formatArticleBody({ articleCaption: '労働時間', text: '本文' })).toBe('（労働時間）\n本文');
  });

  it.each([
    ['（労働時間）', '労働時間'],
    ['(労働時間)', '労働時間'],
    ['労働時間', '労働時間'],
    [' （施行期日） ', '施行期日'],
    ['（定義）（略）', '（定義）（略）'],
    // 安衛則 第3条（live）: 見出しの中にさらに括弧がある
    ['（車両系建設機械（整地・運搬・積込み用及び掘削用）運転技能講習に関する経過措置）', '車両系建設機械（整地・運搬・積込み用及び掘削用）運転技能講習に関する経過措置'],
    ['（a）b（c）', '（a）b（c）'],
    ['（未閉じ', '（未閉じ'],
    ['', ''],
  ])('normalizeArticleCaption(%j) → %j', (input, expected) => {
    expect(normalizeArticleCaption(input)).toBe(expected);
  });
});

describe('共通見出し（commonCaption）', () => {
  it('見出しの無い条は、同じ章の直前の見出しを共通見出しとして引き継ぐ（枝番号）', () => {
    expect(extractArticle(roki, '32の2')?.commonCaption).toEqual({ caption: '労働時間', fromArticle: '32' });
  });

  it('番号が別の条でも、同じ章の直前の見出しを引き継ぐ', () => {
    expect(extractArticle(roki, '10')?.commonCaption).toEqual({ caption: '定義', fromArticle: '9' });
  });

  it('自分の見出しを持つ条には付けない', () => {
    expect(extractArticle(roki, '32')?.commonCaption).toBeUndefined();
  });

  it('章の先頭の条は、前の章の見出しを引き継がない', () => {
    // 第42条は第5章の先頭。直前の条（第4章 第41条）には見出しがあるが、章をまたがない
    expect(extractArticle(roki, '42')?.commonCaption).toBeUndefined();
  });

  it('項だけを取り出しても、条の共通見出しを返す', () => {
    expect(extractArticle(roki, '32の2', 1)?.commonCaption).toEqual({ caption: '労働時間', fromArticle: '32' });
  });

  it('「削除」の条には付けない', () => {
    const deleted = structuredClone(roki);
    const walk = (n: any): void => {
      if (!n || typeof n === 'string') return;
      if (n.tag === 'Article' && n.attr?.Num === '10') {
        n.children = [
          { tag: 'ArticleTitle', attr: {}, children: ['第十条'] },
          { tag: 'Paragraph', attr: { Num: '1' }, children: [{ tag: 'ParagraphNum', attr: {}, children: [] }, { tag: 'ParagraphSentence', attr: {}, children: [{ tag: 'Sentence', attr: {}, children: ['削除'] }] }] },
        ];
      }
      (n.children ?? []).forEach(walk);
    };
    walk(deleted.law_full_text);
    expect(extractArticle(deleted, '10')?.commonCaption).toBeUndefined();
  });

  it('附則の条には付けない', () => {
    const suppl = selectSupplProvision(roki, '令和8年法律第60号')!;
    expect(extractSupplProvision(roki, suppl, { article: '11' })?.commonCaption).toBeUndefined();
  });
});

