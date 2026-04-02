import { jaishIndexCache, jaishPageCache } from '../cache.js';
import { HttpSourceAdapter } from './http-source-adapter.js';

const BASE_URL = 'https://www.jaish.gr.jp';
const USER_AGENT = 'labor-law-mcp/0.2.0 (MCP server for Japanese labor law)';
const MAX_CACHEABLE_HTML_CHARS = 500_000;

class JaishSourceAdapter extends HttpSourceAdapter {
  constructor() {
    super({
      baseUrl: BASE_URL,
      minIntervalMs: 300,
      timeoutMs: 15_000,
      userAgent: USER_AGENT,
      maxConcurrency: 1,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30_000,
    });
  }

  async fetchIndexHtml(path: string): Promise<string> {
    const cached = jaishIndexCache.get(path);
    if (cached) {
      return cached;
    }

    const html = this.decodeShiftJis(await this.fetchArrayBuffer(`${this.baseUrl}${path}`));
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      jaishIndexCache.set(path, html);
    }
    return html;
  }

  async fetchPageHtml(path: string): Promise<string> {
    const cached = jaishPageCache.get(path);
    if (cached) {
      return cached;
    }

    const html = this.decodeShiftJis(await this.fetchArrayBuffer(`${this.baseUrl}${path}`));
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      jaishPageCache.set(path, html);
    }
    return html;
  }

  private decodeShiftJis(buf: ArrayBuffer): string {
    const decoder = new TextDecoder('shift_jis');
    return decoder.decode(buf);
  }
}

export const jaishSourceAdapter = new JaishSourceAdapter();
