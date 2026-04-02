import { jaishIndexRawCache, jaishPageRawCache } from '../cache.js';
import { HttpSourceAdapter } from './http-source-adapter.js';

const BASE_URL = 'https://www.jaish.gr.jp';
const USER_AGENT = 'jp-labor-evidence-mcp/0.2.0 (MCP server for Japanese labor evidence)';
const MAX_CACHEABLE_HTML_CHARS = 500_000;

class JaishSourceAdapter extends HttpSourceAdapter {
  constructor() {
    super({
      baseUrl: BASE_URL,
      sourceName: 'jaish',
      minIntervalMs: 300,
      timeoutMs: 15_000,
      userAgent: USER_AGENT,
      maxConcurrency: 1,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30_000,
    });
  }

  async fetchIndexHtml(path: string): Promise<string> {
    const cached = jaishIndexRawCache.get(path);
    if (cached) {
      return cached;
    }

    const html = this.decodeShiftJis(await this.fetchArrayBuffer(`${this.baseUrl}${path}`));
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      jaishIndexRawCache.set(path, html);
    }
    return html;
  }

  async fetchPageHtml(path: string): Promise<string> {
    const cached = jaishPageRawCache.get(path);
    if (cached) {
      return cached;
    }

    const html = this.decodeShiftJis(await this.fetchArrayBuffer(`${this.baseUrl}${path}`));
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      jaishPageRawCache.set(path, html);
    }
    return html;
  }

  private decodeShiftJis(buf: ArrayBuffer): string {
    const decoder = new TextDecoder('shift_jis');
    return decoder.decode(buf);
  }
}

export const jaishSourceAdapter = new JaishSourceAdapter();
