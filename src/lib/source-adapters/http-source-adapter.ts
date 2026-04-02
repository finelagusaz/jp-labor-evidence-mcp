export interface HttpAdapterOptions {
  baseUrl: string;
  minIntervalMs: number;
  timeoutMs: number;
  userAgent: string;
  maxConcurrency?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetMs?: number;
}

export class HttpSourceAdapter {
  private lastRequestTime = 0;
  private readonly maxConcurrency: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerResetMs: number;
  private inFlight = 0;
  private waiters: Array<() => void> = [];
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly options: HttpAdapterOptions) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 3;
    this.circuitBreakerResetMs = options.circuitBreakerResetMs ?? 30_000;
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
    return await response.json() as T;
  }

  protected async fetchArrayBuffer(url: string, init?: RequestInit): Promise<ArrayBuffer> {
    const response = await this.fetchResponse(url, init);
    return await response.arrayBuffer();
  }

  private async fetchResponse(url: string, init?: RequestInit): Promise<Response> {
    this.ensureCircuitClosed();
    await this.acquireSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      await this.rateLimit();
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
      }
      this.recordSuccess();
      return response;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
      this.releaseSlot();
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.options.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private ensureCircuitClosed(): void {
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error(
        `Circuit breaker is open for ${this.baseUrl} until ${new Date(this.circuitOpenUntil).toISOString()}`
      );
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
