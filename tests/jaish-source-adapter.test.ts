import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jaishIndexRawCache, jaishPageRawCache } from '../src/lib/cache.js';
import { jaishSourceAdapter } from '../src/lib/source-adapters/jaish-source-adapter.js';

function readBinaryFixture(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(process.cwd(), path));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('jaishSourceAdapter', () => {
  beforeEach(() => {
    jaishIndexRawCache.clear();
    jaishPageRawCache.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('インデックス HTML を取得して decode/caching する', async () => {
    const sjisHtml = readBinaryFixture('tests/fixtures/jaish/japanese-shiftjis.html');
    vi.mocked(fetch).mockResolvedValue(
      new Response(sjisHtml, { status: 200, statusText: 'OK' })
    );

    const result1 = await jaishSourceAdapter.fetchIndexHtml('/user/anzen/hor/tsutatsu.html');
    const result2 = await jaishSourceAdapter.fetchIndexHtml('/user/anzen/hor/tsutatsu.html');

    expect(result1).toContain('足場');
    expect(result2).toContain('安全衛生');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('本文 HTML を取得して decode/caching する', async () => {
    const sjisHtml = readBinaryFixture('tests/fixtures/jaish/japanese-shiftjis.html');
    vi.mocked(fetch).mockResolvedValue(
      new Response(sjisHtml, { status: 200, statusText: 'OK' })
    );

    const result1 = await jaishSourceAdapter.fetchPageHtml('/anzen/hor/hombun/fixture.htm');
    const result2 = await jaishSourceAdapter.fetchPageHtml('/anzen/hor/hombun/fixture.htm');

    expect(result1).toContain('足場');
    expect(result2).toContain('安全衛生');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
