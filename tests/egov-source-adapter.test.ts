import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { egovSourceAdapter } from '../src/lib/source-adapters/egov-source-adapter.js';
import { lawDataCache, lawSearchCache } from '../src/lib/cache.js';

describe('egovSourceAdapter', () => {
  beforeEach(() => {
    lawDataCache.clear();
    lawSearchCache.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('law data を取得してキャッシュする', async () => {
    const payload = {
      law_info: {
        law_id: '322AC0000000049',
        law_type: 'Act',
        law_num: '昭和二十二年法律第四十九号',
        promulgation_date: '1947-04-07',
      },
      law_full_text: { tag: 'Law', children: [] },
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result1 = await egovSourceAdapter.fetchLawDataById('322AC0000000049');
    const result2 = await egovSourceAdapter.fetchLawDataById('322AC0000000049');

    expect(result1.law_info.law_id).toBe('322AC0000000049');
    expect(result2.law_info.law_id).toBe('322AC0000000049');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('law search を取得してキャッシュする', async () => {
    const payload = {
      laws: [
        {
          law_info: {
            law_id: '322AC0000000049',
            law_type: 'Act',
            law_num: '昭和二十二年法律第四十九号',
            promulgation_date: '1947-04-07',
          },
          revision_info: {
            law_title: '労働基準法',
          },
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result1 = await egovSourceAdapter.searchLaws('労働基準法', 10);
    const result2 = await egovSourceAdapter.searchLaws('労働基準法', 10);

    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/laws?');
  });
});
