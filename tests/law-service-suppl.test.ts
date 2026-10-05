import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8');
// live の労基則・労基法から切り出したもの（tests/egov-parser-suppl.test.ts と共通）
const fixtures: Record<string, string> = {
  '322M40000100023': raw('suppl-subitem-rokiso.json'),
  '322AC0000000049': raw('suppl-roki.json'),
};

async function loadService() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const id = String(url).split('/').at(-1)!;
    return new Response(fixtures[id] ?? '{}', { status: fixtures[id] ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  // resetModules 後に読み直した service と同じ errors モジュールのクラスで instanceof を判定する
  const errors = await import('../src/lib/errors.js');
  const service = await import('../src/lib/services/law-service.js');
  return { ...service, NotFoundError: errors.NotFoundError, ValidationError: errors.ValidationError };
}

describe('getArticleByLawId: 附則・細分・号', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('article も supplementary も無ければ ValidationError', async () => {
    const { getArticleByLawId, ValidationError } = await loadService();
    await expect(getArticleByLawId({ lawId: '322AC0000000049' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('subitem には item が必要', async () => {
    const { getArticleByLawId } = await loadService();
    await expect(getArticleByLawId({ lawId: '322M40000100023', article: '7の2', subitem: 'ロ' }))
      .rejects.toThrow(/item/);
  });

  it('「附則第1条」を article に渡したら supplementary を案内する', async () => {
    const { getArticleByLawId } = await loadService();
    await expect(getArticleByLawId({ lawId: '322AC0000000049', article: '附則第1条' }))
      .rejects.toThrow(/supplementary/);
  });

  it('附則の条: supplementary の情報を返し、本則の同じ番号と取り違えない', async () => {
    const { getArticleByLawId } = await loadService();
    const main = await getArticleByLawId({ lawId: '322AC0000000049', article: '1' });
    const suppl = await getArticleByLawId({ lawId: '322AC0000000049', article: '1', supplementary: '令和八年法律第六十号' });
    expect(suppl.supplementary).toEqual({ key: '令和8年法律第60号', amendLawNum: '令和八年七月一七日法律第六〇号', extract: true });
    expect(main.supplementary).toBeUndefined();
    expect(suppl.text).not.toBe(main.text);
  });

  it('条を持たない附則の号: 項を特定して返す', async () => {
    const { getArticleByLawId } = await loadService();
    const r = await getArticleByLawId({ lawId: '322AC0000000049', supplementary: '昭和27年法律第287号', item: 5 });
    expect(r.paragraph).toBe(4);
    expect(r.article).toBe('');
  });

  it('該当する附則が無ければ NotFoundError で一覧 tool を案内する', async () => {
    const { getArticleByLawId, NotFoundError } = await loadService();
    await expect(getArticleByLawId({ lawId: '322AC0000000049', supplementary: '令和8年法律第1号' }))
      .rejects.toSatisfy((e: unknown) => e instanceof NotFoundError && /list_suppl_provisions/.test((e as Error).message));
  });

  it('細分の正規形と、paragraph を省いたときの項を返す', async () => {
    const { getArticleByLawId } = await loadService();
    const r = await getArticleByLawId({ lawId: '322M40000100023', article: '7の2', item: 2, subitem: 'ロ（１）（ｉｉｉ）' });
    expect(r.subitem).toBe('ロ/1/iii');
    expect(r.paragraph).toBe(1);
    expect(r.text).toMatch(/^（ｉｉｉ）/);
  });

  it('paragraph を省いた号が複数の項にあれば ValidationError（deprecated get_law も同じ経路）', async () => {
    const { getLawArticle } = await loadService();
    await expect(getLawArticle({ lawName: '322M40000100023', article: '5', item: 2 })).rejects.toThrow(/第1項、第4項/);
  });
});

describe('listSupplProvisionsByLawId', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('新しい順（公布日）で返す。公布日の年が番号の年と食い違う附則は公布日で並べる', async () => {
    const { listSupplProvisionsByLawId } = await loadService();
    const r = await listSupplProvisionsByLawId({ lawId: '322M40000100023' });
    expect(r.items.map((s) => s.key)).toEqual([
      '令和8年厚生労働省令第57号',
      '平成13年厚生労働省令第2号',
      '平成元年労働省令第1号',
      '制定',
    ]);
    expect(r).toMatchObject({ total: 4, hasMore: false, lawTitle: '労働基準法施行規則' });
  });

  it('limit / offset / hasMore', async () => {
    const { listSupplProvisionsByLawId } = await loadService();
    const first = await listSupplProvisionsByLawId({ lawId: '322M40000100023', limit: 2 });
    expect(first.items.map((s) => s.key)).toEqual(['令和8年厚生労働省令第57号', '平成13年厚生労働省令第2号']);
    expect(first).toMatchObject({ total: 4, hasMore: true });
    const rest = await listSupplProvisionsByLawId({ lawId: '322M40000100023', limit: 2, offset: 2 });
    expect(rest.items.map((s) => s.key)).toEqual(['平成元年労働省令第1号', '制定']);
    expect(rest.hasMore).toBe(false);
  });

  it('年だけ・番号までで絞り込める', async () => {
    const { listSupplProvisionsByLawId, ValidationError } = await loadService();
    expect((await listSupplProvisionsByLawId({ lawId: '322M40000100023', amendmentLawNum: '平成13年' })).items.map((s) => s.key))
      .toEqual(['平成13年厚生労働省令第2号']);
    expect((await listSupplProvisionsByLawId({ lawId: '322M40000100023', amendmentLawNum: '平成元年労働省令第一号' })).total).toBe(1);
    await expect(listSupplProvisionsByLawId({ lawId: '322M40000100023', amendmentLawNum: 'あいう' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('条の番号は先頭 20 件までにして件数を併記する', async () => {
    const { listSupplProvisionsByLawId } = await loadService();
    const enactment = (await listSupplProvisionsByLawId({ lawId: '322AC0000000049' })).items.find((s) => s.key === '制定')!;
    expect(enactment.articleNums.length).toBeLessThanOrEqual(20);
    expect(enactment.articleCount).toBeGreaterThanOrEqual(enactment.articleNums.length);
  });
});
