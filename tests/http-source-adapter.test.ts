import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpSourceAdapter } from '../src/lib/source-adapters/http-source-adapter.js';

class TestHttpAdapter extends HttpSourceAdapter {
  async getText(url: string, init?: RequestInit): Promise<string> {
    return await this.fetchText(url, init);
  }
}

describe('HttpSourceAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('User-Agent を付けて text を取得する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('ok', { status: 200, statusText: 'OK' })
    );

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 0,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
    });

    await expect(adapter.getText('https://example.com/test')).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'test-agent',
        }),
      })
    );
  });

  it('非 200 応答はエラーにする', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('fail', { status: 503, statusText: 'Service Unavailable' })
    );

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 0,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
    });

    await expect(adapter.getText('https://example.com/test')).rejects.toThrow(
      'HTTP 503 Service Unavailable'
    );
  });
});
