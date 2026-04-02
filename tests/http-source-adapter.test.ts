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
    vi.useRealTimers();
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

  it('maxConcurrency=1 のとき並列呼び出しを直列化する', async () => {
    let firstResolved = false;
    let secondStartedBeforeFirstResolved = false;

    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/first')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        firstResolved = true;
        return new Response('first', { status: 200, statusText: 'OK' });
      }

      secondStartedBeforeFirstResolved = !firstResolved;
      return new Response('second', { status: 200, statusText: 'OK' });
    });

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 0,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
      maxConcurrency: 1,
    });

    const [first, second] = await Promise.all([
      adapter.getText('https://example.com/first'),
      adapter.getText('https://example.com/second'),
    ]);

    expect(first).toBe('first');
    expect(second).toBe('second');
    expect(secondStartedBeforeFirstResolved).toBe(false);
  });

  it('連続失敗で circuit breaker を開く', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(
      new Response('fail', { status: 503, statusText: 'Service Unavailable' })
    );

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 0,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
      circuitBreakerThreshold: 2,
      circuitBreakerResetMs: 10_000,
    });

    await expect(adapter.getText('https://example.com/a')).rejects.toThrow('HTTP 503');
    await expect(adapter.getText('https://example.com/b')).rejects.toThrow('HTTP 503');
    await expect(adapter.getText('https://example.com/c')).rejects.toThrow('Circuit breaker is open');
  });
});
