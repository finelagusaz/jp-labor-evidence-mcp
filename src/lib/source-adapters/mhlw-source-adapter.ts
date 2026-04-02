import { mhlwDocRawCache, mhlwSearchRawCache } from '../cache.js';
import { HttpSourceAdapter } from './http-source-adapter.js';

const BASE_URL = 'https://www.mhlw.go.jp/web';
const USER_AGENT = 'jp-labor-evidence-mcp/0.2.0 (MCP server for Japanese labor evidence)';
const MAX_CACHEABLE_HTML_CHARS = 500_000;

class MhlwSourceAdapter extends HttpSourceAdapter {
  constructor() {
    super({
      baseUrl: BASE_URL,
      sourceName: 'mhlw',
      minIntervalMs: 200,
      timeoutMs: 15_000,
      userAgent: USER_AGENT,
      maxConcurrency: 1,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30_000,
    });
  }

  async fetchSearchHtml(keyword: string, page: number): Promise<string> {
    const cacheKey = `search:${keyword}:${page}`;
    const cached = mhlwSearchRawCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({
      keyword,
      type: '1',
      mode: '0',
      page: String(page),
    });
    const html = await this.fetchText(`${this.baseUrl}/t_docsrch_keyword?${params}`);
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      mhlwSearchRawCache.set(cacheKey, html);
    }
    return html;
  }

  async fetchDocumentHtml(dataId: string, pageNo: number): Promise<string> {
    const cacheKey = `doc:${dataId}:${pageNo}`;
    const cached = mhlwDocRawCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({
      dataId,
      dataType: '1',
      pageNo: String(pageNo),
    });
    const html = await this.fetchText(`${this.baseUrl}/t_doc?${params}`);
    if (html.length <= MAX_CACHEABLE_HTML_CHARS) {
      mhlwDocRawCache.set(cacheKey, html);
    }
    return html;
  }
}

export const mhlwSourceAdapter = new MhlwSourceAdapter();
