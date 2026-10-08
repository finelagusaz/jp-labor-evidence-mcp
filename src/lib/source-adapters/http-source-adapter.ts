import { observabilityRegistry } from '../observability.js';
import { CircuitOpenError, ExternalApiError, ParseError, UpstreamHttpError, UpstreamNotFoundError, UpstreamTimeoutError } from '../errors.js';

export interface HttpAdapterOptions {
  baseUrl: string;
  minIntervalMs: number;
  timeoutMs: number;
  userAgent: string;
  maxConcurrency?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
  sourceName?: string;
}

export class HttpSourceAdapter {
  private lastRequestTime = 0;
  private readonly maxConcurrency: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerResetMs: number;
  private readonly sourceName: string;
  private rateLimitQueue: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private waiters: Array<() => void> = [];
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly options: HttpAdapterOptions) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 3;
    this.circuitBreakerResetMs = options.circuitBreakerResetMs ?? 30_000;
    this.sourceName = options.sourceName ?? options.baseUrl;
  }

  protected get baseUrl(): string {
    return this.options.baseUrl;
  }

  protected async fetchText(url: string, init?: RequestInit): Promise<string> {
    const response = await this.fetchResponse(url, init);
    return await response.text();
  }

  protected async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchResponse(url, init);
    try {
      return await response.json() as T;
    } catch (error) {
      throw new ParseError(`上流の応答を JSON として解釈できませんでした — ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected async fetchArrayBuffer(url: string, init?: RequestInit): Promise<ArrayBuffer> {
    const response = await this.fetchResponse(url, init);
    return await response.arrayBuffer();
  }

  private async fetchResponse(url: string, init?: RequestInit): Promise<Response> {
    const startedAt = Date.now();
    this.ensureCircuitClosed();
    await this.acquireSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      this.ensureCircuitClosed();
      await this.rateLimit();
      this.ensureCircuitClosed();
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw response.status === 404
          ? new UpstreamNotFoundError(url, response.statusText || 'Not Found')
          : new UpstreamHttpError(response.status, response.statusText, url);
      }
      this.recordSuccess();
      observabilityRegistry.recordUpstreamRequest(this.sourceName, Date.now() - startedAt, 'success');
      return response;
    } catch (error) {
      const typed = this.toTypedError(error, url);
      // 再試行しても無駄な 4xx（404 など）は、上流が応答できているのでサーキットの失敗に数えない。
      // サーキット開放のエラー自身も数えない（数えると開いている時間を延ばしてしまう）
      if (typed instanceof CircuitOpenError) {
        // 何もしない
      } else if (typed instanceof ExternalApiError && typed.retryable) {
        this.recordFailure();
      } else if (typed instanceof UpstreamNotFoundError || typed instanceof UpstreamHttpError) {
        this.recordSuccess();
      }
      observabilityRegistry.recordUpstreamRequest(this.sourceName, Date.now() - startedAt, 'failure');
      if (typed instanceof UpstreamTimeoutError) {
        observabilityRegistry.recordTimeout(this.sourceName);
      }
      throw typed;
    } finally {
      clearTimeout(timeout);
      this.releaseSlot();
    }
  }

  /** fetch や応答の検査で投げられた失敗を、型付きのエラーにそろえる */
  private toTypedError(error: unknown, url: string): Error {
    if (error instanceof ExternalApiError || error instanceof UpstreamNotFoundError) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new UpstreamTimeoutError(url, this.options.timeoutMs);
    }
    return new ExternalApiError(
      `上流に接続できませんでした — ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true, cause: error },
    );
  }

  private async rateLimit(): Promise<void> {
    const previous = this.rateLimitQueue;
    let release!: () => void;
    this.rateLimitQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.options.minIntervalMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.minIntervalMs - elapsed));
      }
      this.lastRequestTime = Date.now();
    } finally {
      release();
    }
  }

  private ensureCircuitClosed(): void {
    if (Date.now() < this.circuitOpenUntil) {
      observabilityRegistry.recordCircuitOpen(this.sourceName);
      throw new CircuitOpenError(this.baseUrl, new Date(this.circuitOpenUntil).toISOString());
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      this.circuitOpenUntil = Date.now() + this.circuitBreakerResetMs;
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}
