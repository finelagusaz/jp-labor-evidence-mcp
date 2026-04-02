import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mhlwDocRawCache, mhlwSearchRawCache } from '../src/lib/cache.js';
import { mhlwSourceAdapter } from '../src/lib/source-adapters/mhlw-source-adapter.js';

describe('mhlwSourceAdapter', () => {
  beforeEach(() => {
    mhlwSearchRawCache.clear();
    mhlwDocRawCache.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('検索 HTML を取得してキャッシュする', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<html>search</html>', { status: 200, statusText: 'OK' })
    );

    const result1 = await mhlwSourceAdapter.fetchSearchHtml('足場', 0);
    const result2 = await mhlwSourceAdapter.fetchSearchHtml('足場', 0);

    expect(result1).toBe('<html>search</html>');
    expect(result2).toBe('<html>search</html>');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('t_docsrch_keyword?');
  });

  it('本文 HTML を取得してキャッシュする', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<html>doc</html>', { status: 200, statusText: 'OK' })
    );

    const result1 = await mhlwSourceAdapter.fetchDocumentHtml('00tb2035', 1);
    const result2 = await mhlwSourceAdapter.fetchDocumentHtml('00tb2035', 1);

    expect(result1).toBe('<html>doc</html>');
    expect(result2).toBe('<html>doc</html>');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('t_doc?');
  });
});
