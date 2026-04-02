import { describe, expect, it } from 'vitest';
import { buildJaishIndexEntry, buildLawIndexEntry, buildMhlwIndexEntry } from '../src/lib/indexes/builders.js';
import { deserializeLawIndex, serializeLawIndex } from '../src/lib/indexes/serialization.js';

describe('index schema', () => {
  it('law index entry を構築できる', () => {
    const entry = buildLawIndexEntry({
      lawId: '322AC0000000049',
      lawTitle: '労働基準法',
      lawNum: '昭和二十二年法律第四十九号',
      lawType: 'Act',
      aliases: ['労基法'],
      sourceUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      updatedAt: '2026-04-02T00:00:00.000Z',
      freshness: 'fresh',
    });

    expect(entry.canonical_id).toBe('egov:322AC0000000049');
    expect(entry.citations[0]?.locator).toBe('322AC0000000049');
    expect(entry.freshness).toBe('fresh');
  });

  it('tsutatsu index entry を source 別に構築できる', () => {
    const mhlw = buildMhlwIndexEntry({
      title: '労働時間の適正把握について',
      dataId: '00tb2035',
      date: '2024-01-01',
      shubetsu: '基発0101第1号',
    }, 'fresh');
    const jaish = buildJaishIndexEntry({
      title: '足場の安全基準について',
      number: '基安発0106第3号',
      date: '2026-01-06',
      url: '/anzen/example.htm',
    }, 'stale');

    expect(mhlw.canonical_id).toBe('mhlw:00tb2035');
    expect(jaish.canonical_id).toBe('jaish:/anzen/example.htm');
    expect(jaish.freshness).toBe('stale');
  });

  it('law index を serialize / deserialize できる', () => {
    const serialized = serializeLawIndex({
      meta: {
        source: 'egov',
        generated_at: '2026-04-02T00:00:00.000Z',
        last_success_at: '2026-04-02T00:00:00.000Z',
        freshness: 'fresh',
        entry_count: 1,
      },
      entries: [buildLawIndexEntry({
        lawId: '322AC0000000049',
        lawTitle: '労働基準法',
        lawType: 'Act',
        sourceUrl: 'https://laws.e-gov.go.jp/law/322AC0000000049',
      })],
    });

    const parsed = deserializeLawIndex(serialized);

    expect(parsed.meta.source).toBe('egov');
    expect(parsed.entries[0]?.canonical_id).toBe('egov:322AC0000000049');
  });
});
