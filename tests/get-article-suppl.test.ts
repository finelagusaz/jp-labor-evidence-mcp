import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { callTool } from './test-helpers/mcp-internals.js';

const raw = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/egov/${name}`, import.meta.url)), 'utf8');
// live の労基則・労基法から切り出したもの（tests/egov-parser-suppl.test.ts と共通）
const fixtures: Record<string, string> = {
  '322M40000100023': raw('suppl-subitem-rokiso.json'),
  '322AC0000000049': raw('suppl-roki.json'),
};

async function connect() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const id = String(url).split('/').at(-1)!;
    return new Response(fixtures[id] ?? '{}', { status: fixtures[id] ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  const { createServer } = await import('../src/server.js');
  return createServer();
}

describe('get_article: 附則・細分・号', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('revision_metadata.amendment_law_num をそのまま supplementary に渡すと、現行版を生んだ改正の附則が取れる', async () => {
    const server = await connect();
    const main = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '1' });
    const amendmentLawNum = main.data.revision_metadata.amendment_law_num;
    expect(amendmentLawNum).toBe('令和八年法律第六十号');

    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', article: '1', supplementary: amendmentLawNum });
    expect(env.status).toBe('ok');
    expect(env.data.supplementary).toEqual({ key: '令和8年法律第60号', amend_law_num: '令和八年七月一七日法律第六〇号', extract: true });
    expect(env.data.title).toBe('労働基準法 附則（令和8年法律第60号・抄）第1条');
    expect(env.data.canonical_id).toBe('egov:322AC0000000049:suppl:令和8年法律第60号:article:1');
    expect(env.data.body).not.toBe(main.data.body);
  });

  it('条を持たない附則の号: article を省き、特定した項を返す', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '322AC0000000049', supplementary: '昭和27年法律第287号', item: '五' });
    expect(env.status).toBe('ok');
    expect(env.data.article).toBeUndefined();
    expect(env.data.paragraph).toBe(4);
    expect(env.data.item).toBe('五');
    expect(env.data.title).toBe('労働基準法 附則（昭和27年法律第287号・抄）第4項第5号');
    expect(env.data.canonical_id).toBe('egov:322AC0000000049:suppl:昭和27年法律第287号:paragraph:4:item:5');
  });

  it('制定時附則のブロック全体', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', supplementary: '制定' });
    expect(env.status).toBe('ok');
    expect(env.data.canonical_id).toBe('egov:322M40000100023:suppl:制定');
    expect(env.data.title).toBe('労働基準法施行規則 附則（制定時・抄）');
  });

  it('本則の細分: canonical_id と title に正規形を載せる', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', article: '7の2', paragraph: 1, item: 2, subitem: 'ロ (1) (iii)' });
    expect(env.status).toBe('ok');
    expect(env.data.subitem).toBe('ロ/1/iii');
    expect(env.data.title).toBe('労働基準法施行規則 第7の2条第1項第2号ロ（1）（iii）');
    expect(env.data.canonical_id).toBe('egov:322M40000100023:article:7の2:paragraph:1:item:2:subitem:ロ/1/iii');
    expect(env.data.body).toMatch(/^（ｉｉｉ）/);
  });

  it('枝番号の号は漢数字で指定しても canonical_id がそろう', async () => {
    const server = await connect();
    const a = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', article: '5', paragraph: 1, item: '一の二' });
    const b = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', article: '5', paragraph: 1, item: '1の2' });
    expect(a.data.canonical_id).toBe('egov:322M40000100023:article:5:paragraph:1:item:1の2');
    expect(b.data.canonical_id).toBe(a.data.canonical_id);
  });

  it('本則の数値の号はこれまでどおり', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', article: '5', paragraph: 1, item: 6 });
    expect(env.data.canonical_id).toBe('egov:322M40000100023:article:5:paragraph:1:item:6');
    expect(env.data.item).toBe(6);
  });

  it('曖昧な号・解釈できない附則の指定は invalid', async () => {
    const server = await connect();
    const ambiguous = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', article: '5', item: 2 });
    expect(ambiguous.status).toBe('invalid');
    const bad = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', supplementary: '令和8年' });
    expect(bad.status).toBe('invalid');
  });
});

describe('list_suppl_provisions', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('新しい順の一覧と、get_article にそのまま渡せる key を返す', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'list_suppl_provisions', { law_id: '322M40000100023' });
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ law_title: '労働基準法施行規則', total: 4, has_more: false });
    expect(env.data.items.map((i: any) => i.key)).toEqual([
      '令和8年厚生労働省令第57号', '平成13年厚生労働省令第2号', '平成元年労働省令第1号', '制定',
    ]);
    expect(env.data.items[2]).toMatchObject({
      canonical_id: 'egov:322M40000100023:suppl:平成元年労働省令第1号',
      amend_law_num: '平成元年二月一〇日労働省令第一号',
      extract: false, article_count: 0, paragraph_count: 2,
    });
    expect(env.data.version_info).toBeDefined();

    const picked = await callTool<any>(server, 'get_article', { law_id: '322M40000100023', supplementary: env.data.items[2].key, paragraph: 1 });
    expect(picked.status).toBe('ok');
    expect(picked.data.canonical_id).toBe('egov:322M40000100023:suppl:平成元年労働省令第1号:paragraph:1');
  });

  it('絞り込み・limit・offset', async () => {
    const server = await connect();
    const byYear = await callTool<any>(server, 'list_suppl_provisions', { law_id: '322M40000100023', amendment_law_num: '令和8年' });
    expect(byYear.data.items.map((i: any) => i.key)).toEqual(['令和8年厚生労働省令第57号']);
    const page = await callTool<any>(server, 'list_suppl_provisions', { law_id: '322M40000100023', limit: 1, offset: 1 });
    expect(page.data).toMatchObject({ total: 4, has_more: true });
    expect(page.data.items.map((i: any) => i.key)).toEqual(['平成13年厚生労働省令第2号']);
  });

  it('解釈できない絞り込みは invalid', async () => {
    const server = await connect();
    const env = await callTool<any>(server, 'list_suppl_provisions', { law_id: '322M40000100023', amendment_law_num: 'あいう' });
    expect(env.status).toBe('invalid');
  });
});

