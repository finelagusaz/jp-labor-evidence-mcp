import { buildEgovLawCanonicalId, buildJaishCanonicalId, buildMhlwDocumentCanonicalId } from '../canonical-id.js';
import type { JaishIndexEntry, MhlwSearchResult } from '../types.js';
import type { Citation, IndexFreshness, LawIndexEntry, TsutatsuIndexEntry } from './types.js';

export function createLawCitation(lawTitle: string, lawId: string): Citation {
  return {
    label: lawTitle,
    locator: lawId,
    source_type: 'egov',
    source_url: `https://laws.e-gov.go.jp/law/${lawId}`,
    citation_basis: 'index',
  };
}

export function buildLawIndexEntry(params: {
  lawId: string;
  lawTitle: string;
  lawNum?: string;
  lawType: string;
  aliases?: string[];
  sourceUrl: string;
  updatedAt?: string;
  freshness?: IndexFreshness;
}): LawIndexEntry {
  return {
    canonical_id: buildEgovLawCanonicalId(params.lawId),
    law_id: params.lawId,
    law_title: params.lawTitle,
    law_num: params.lawNum,
    law_type: params.lawType,
    aliases: params.aliases ?? [],
    source_url: params.sourceUrl,
    updated_at: params.updatedAt,
    freshness: params.freshness ?? 'unknown',
    citations: [createLawCitation(params.lawTitle, params.lawId)],
  };
}

export function buildMhlwIndexEntry(result: MhlwSearchResult, freshness: IndexFreshness = 'unknown'): TsutatsuIndexEntry {
  return {
    canonical_id: buildMhlwDocumentCanonicalId(result.dataId),
    source_type: 'mhlw',
    title: result.title,
    source_url: `https://www.mhlw.go.jp/web/t_doc?dataId=${result.dataId}&dataType=1&pageNo=1`,
    number: result.shubetsu,
    date: result.date,
    aliases: [],
    updated_at: result.date,
    freshness,
    citations: [{
      label: result.title,
      locator: result.shubetsu,
      source_type: 'mhlw',
      source_url: `https://www.mhlw.go.jp/web/t_doc?dataId=${result.dataId}&dataType=1&pageNo=1`,
      citation_basis: 'index',
    }],
  };
}

export function buildJaishIndexEntry(result: JaishIndexEntry, freshness: IndexFreshness = 'unknown'): TsutatsuIndexEntry {
  return {
    canonical_id: buildJaishCanonicalId(result.url),
    source_type: 'jaish',
    title: result.title,
    source_url: result.url.startsWith('http') ? result.url : `https://www.jaish.gr.jp${result.url}`,
    number: result.number,
    date: result.date,
    aliases: [],
    updated_at: result.date,
    freshness,
    citations: [{
      label: result.title,
      locator: result.number,
      source_type: 'jaish',
      source_url: result.url.startsWith('http') ? result.url : `https://www.jaish.gr.jp${result.url}`,
      citation_basis: 'index',
    }],
  };
}
