export interface HttpAdapterOptions {
  baseUrl: string;
  minIntervalMs: number;
  timeoutMs: number;
  userAgent: string;
}

export class HttpSourceAdapter {
  private lastRequestTime = 0;

  constructor(private readonly options: HttpAdapterOptions) {}

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
    await this.rateLimit();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
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
      return response;
    } finally {
      clearTimeout(timeout);
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
}
