import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpSourceAdapter } from '../src/lib/source-adapters/http-source-adapter.js';
import { CircuitOpenError, ExternalApiError, NotFoundError, ParseError, UpstreamHttpError, UpstreamNotFoundError, UpstreamTimeoutError } from '../src/lib/errors.js';

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

  it('待機中のリクエストも circuit open 後は upstream に送らない', async () => {
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/first')) {
        await firstDone;
        return new Response('fail', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response('ok', { status: 200, statusText: 'OK' });
    });

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 0,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
      maxConcurrency: 1,
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 10_000,
    });

    const first = adapter.getText('https://example.com/first');
    const second = adapter.getText('https://example.com/second');
    releaseFirst();

    await expect(first).rejects.toThrow('HTTP 503');
    await expect(second).rejects.toThrow('Circuit breaker is open');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maxConcurrency > 1 でも rate limit を直列化する', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];

    vi.mocked(fetch).mockImplementation(async () => {
      callTimes.push(Date.now());
      return new Response('ok', { status: 200, statusText: 'OK' });
    });

    const adapter = new TestHttpAdapter({
      baseUrl: 'https://example.com',
      minIntervalMs: 100,
      timeoutMs: 1_000,
      userAgent: 'test-agent',
      maxConcurrency: 2,
    });

    const p1 = adapter.getText('https://example.com/first');
    const p2 = adapter.getText('https://example.com/second');
    await vi.advanceTimersByTimeAsync(100);

    await expect(Promise.all([p1, p2])).resolves.toEqual(['ok', 'ok']);
    expect(callTimes).toHaveLength(2);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(100);
  });
});

describe('HttpSourceAdapter: 型付きエラー', () => {
  class JsonAdapter extends HttpSourceAdapter {
    async getText(url: string): Promise<string> {
      return await this.fetchText(url);
    }
    async getJson(url: string): Promise<unknown> {
      return await this.fetchJson(url);
    }
  }
  const adapter = (overrides: Partial<ConstructorParameters<typeof HttpSourceAdapter>[0]> = {}) =>
    new JsonAdapter({ baseUrl: 'https://example.com', minIntervalMs: 0, timeoutMs: 1_000, userAgent: 'test', ...overrides });
  const respond = (status: number, statusText: string, body = '') => new Response(body, { status, statusText });

  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('404 は UpstreamNotFoundError（NotFoundError）', async () => {
    vi.mocked(fetch).mockResolvedValue(respond(404, 'Not Found'));
    const error = await adapter().getText('https://example.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamNotFoundError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.httpStatus).toBe(404);
    expect(error.message).toBe('HTTP 404 Not Found — https://example.com/x');
  });

  it.each([
    [503, 'Service Unavailable', true],
    [500, 'Internal Server Error', true],
    [429, 'Too Many Requests', true],
    [408, 'Request Timeout', true],
    [400, 'Bad Request', false],
    [403, 'Forbidden', false],
  ])('HTTP %d は UpstreamHttpError（ExternalApiError）で retryable=%s', async (status, statusText, retryable) => {
    vi.mocked(fetch).mockResolvedValue(respond(status, statusText));
    const error = await adapter().getText('https://example.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect(error).toBeInstanceOf(ExternalApiError);
    expect(error.httpStatus).toBe(status);
    expect(error.retryable).toBe(retryable);
  });

  it('タイムアウトは UpstreamTimeoutError（再試行可）', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const error = await adapter({ timeoutMs: 10 }).getText('https://example.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
    expect(error.retryable).toBe(true);
  });

  it('接続の失敗は ExternalApiError（再試行可）', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
    const error = await adapter().getText('https://example.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(ExternalApiError);
    expect(error.retryable).toBe(true);
  });

  it('壊れた JSON は ParseError', async () => {
    vi.mocked(fetch).mockResolvedValue(respond(200, 'OK', '{ broken'));
    await expect(adapter().getJson('https://example.com/x')).rejects.toBeInstanceOf(ParseError);
  });

  it('再試行可の失敗が続くとサーキットが開き、CircuitOpenError（上流は呼ばない）', async () => {
    vi.mocked(fetch).mockResolvedValue(respond(503, 'Service Unavailable'));
    const a = adapter({ circuitBreakerThreshold: 3 });
    for (let i = 0; i < 3; i++) await a.getText('https://example.com/x').catch(() => {});
    const error = await a.getText('https://example.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(CircuitOpenError);
    expect(error.retryable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('サーキットが開いている間の要求は、開いている時間を延ばさない', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(respond(503, 'Service Unavailable'));
    const a = adapter({ circuitBreakerThreshold: 3, circuitBreakerResetMs: 1_000 });
    for (let i = 0; i < 3; i++) await a.getText('https://example.com/x').catch(() => {});
    const first = await a.getText('https://example.com/x').catch((e) => e);
    vi.advanceTimersByTime(500);
    const second = await a.getText('https://example.com/x').catch((e) => e);
    expect(second.retryAt).toBe(first.retryAt);
    vi.useRealTimers();
  });

  it('404 が続いてもサーキットは開かない（上流は応答できている）', async () => {
    vi.mocked(fetch).mockResolvedValue(respond(404, 'Not Found'));
    const a = adapter({ circuitBreakerThreshold: 3 });
    for (let i = 0; i < 5; i++) {
      await expect(a.getText('https://example.com/x')).rejects.toBeInstanceOf(UpstreamNotFoundError);
    }
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
