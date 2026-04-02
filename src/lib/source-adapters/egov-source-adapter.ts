import { lawDataCache, lawSearchCache } from '../cache.js';
import type { EgovLawData, EgovLawSearchResult } from '../types.js';
import { HttpSourceAdapter } from './http-source-adapter.js';

const EGOV_API_BASE = 'https://laws.e-gov.go.jp/api/2';
const USER_AGENT = 'labor-law-mcp/0.2.0 (MCP server for Japanese labor law)';
const MAX_CACHEABLE_JSON_CHARS = 500_000;

class EgovSourceAdapter extends HttpSourceAdapter {
  constructor() {
    super({
      baseUrl: EGOV_API_BASE,
      sourceName: 'egov',
      minIntervalMs: 200,
      timeoutMs: 30_000,
      userAgent: USER_AGENT,
      maxConcurrency: 1,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30_000,
    });
  }

  async fetchLawDataById(lawId: string): Promise<EgovLawData> {
    const cached = lawDataCache.get(lawId);
    if (cached) {
      return JSON.parse(cached) as EgovLawData;
    }

    const url = `${this.baseUrl}/law_data/${lawId}`;
    const data = await this.fetchJson<EgovLawData>(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    const serialized = JSON.stringify(data);
    if (serialized.length <= MAX_CACHEABLE_JSON_CHARS) {
      lawDataCache.set(lawId, serialized);
    }

    return data;
  }

  async searchLaws(keyword: string, limit: number, lawType?: string): Promise<EgovLawSearchResult[]> {
    const cacheKey = `${keyword}|${limit}|${lawType ?? ''}`;
    const cached = lawSearchCache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as EgovLawSearchResult[];
    }

    const params = new URLSearchParams({
      law_title: keyword,
      limit: String(limit),
      response_format: 'json',
    });
    if (lawType) {
      params.set('law_type', lawType);
    }

    const url = `${this.baseUrl}/laws?${params}`;
    const json = await this.fetchJson<{ laws?: EgovLawSearchResult[] }>(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    const results = (json.laws ?? []) as EgovLawSearchResult[];

    const serialized = JSON.stringify(results);
    if (serialized.length <= MAX_CACHEABLE_JSON_CHARS) {
      lawSearchCache.set(cacheKey, serialized);
    }

    return results;
  }
}

export const egovSourceAdapter = new EgovSourceAdapter();
