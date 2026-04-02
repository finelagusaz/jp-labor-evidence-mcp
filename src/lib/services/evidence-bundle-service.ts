import { buildEgovArticleCanonicalId, buildMhlwDocumentCanonicalId, buildJaishCanonicalId } from '../canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../evidence-metadata.js';
import type { PartialFailure, WarningMessage } from '../types.js';
import { findRelatedSources, getArticleByLawId, getLawToc } from './law-service.js';
import { searchJaishTsutatsu } from './jaish-tsutatsu-service.js';
import { searchMhlwTsutatsu } from './mhlw-tsutatsu-service.js';

export interface EvidenceRecord {
  source_type: 'egov' | 'mhlw' | 'jaish';
  canonical_id: string;
  title: string;
  body?: string;
  source_url: string;
  retrieved_at: string;
  warnings: WarningMessage[];
  version_info?: string;
  upstream_hash: string;
  article_locator?: {
    law_id: string;
    article: string;
    paragraph?: number;
    item?: number;
  };
  date?: string;
  number?: string;
}

export interface EvidenceBundleResult {
  status: 'ok' | 'partial';
  primary_evidence: EvidenceRecord;
  delegated_evidence: EvidenceRecord[];
  related_tsutatsu: EvidenceRecord[];
  warnings: WarningMessage[];
  partial_failures: PartialFailure[];
  search_keywords: string[];
}

export async function getEvidenceBundle(params: {
  lawId: string;
  article: string;
  paragraph?: number;
  item?: number;
  relatedKeywords?: string[];
  includeJaish?: boolean;
  mhlwLimit?: number;
  jaishLimit?: number;
  jaishMaxPages?: number;
}): Promise<EvidenceBundleResult> {
  const primary = await getArticleByLawId({
    lawId: params.lawId,
    article: params.article,
    paragraph: params.paragraph,
    item: params.item,
  });
  const retrievedAt = new Date().toISOString();
  const primaryTitle = buildPrimaryTitle(primary.lawTitle, params.article, params.paragraph, params.item);
  const primaryBody = `${primary.articleCaption ? `（${primary.articleCaption}）\n` : ''}${primary.text}`;
  const primaryEvidence: EvidenceRecord = {
    source_type: 'egov',
    canonical_id: buildEgovArticleCanonicalId(primary.lawId, params.article, params.paragraph, params.item),
    title: primaryTitle,
    body: primaryBody,
    source_url: primary.egovUrl,
    retrieved_at: retrievedAt,
    warnings: [],
    version_info: joinVersionInfo([primary.lawNum, primary.promulgationDate]),
    upstream_hash: computeUpstreamHash([primary.lawId, primaryTitle, primaryBody, primary.egovUrl]),
    article_locator: {
      law_id: primary.lawId,
      article: params.article,
      paragraph: params.paragraph,
      item: params.item,
    },
  };

  const related = await findRelatedSources({
    lawId: primary.lawId,
    article: params.article,
    articleCaption: primary.articleCaption,
  });
  const keywords = normalizeKeywords(params.relatedKeywords, related.searchKeywords);
  const warnings: WarningMessage[] = [...related.warnings];
  const partialFailures: PartialFailure[] = [];
  const delegatedEvidence: EvidenceRecord[] = [];
  const relatedTsutatsu: EvidenceRecord[] = [];

  for (const delegatedLaw of related.delegatedLaws) {
    const toc = await getLawToc({ lawName: delegatedLaw.lawId });
    delegatedEvidence.push({
      source_type: 'egov',
      canonical_id: `egov:${delegatedLaw.lawId}:toc`,
      title: `${delegatedLaw.lawTitle} — 目次`,
      body: toc.toc,
      source_url: toc.egovUrl,
      retrieved_at: retrievedAt,
      warnings: [],
      version_info: joinVersionInfo([toc.lawNum, toc.promulgationDate]),
      upstream_hash: computeUpstreamHash([delegatedLaw.lawId, delegatedLaw.lawTitle, toc.toc, toc.egovUrl]),
    });
  }

  for (const keyword of keywords) {
    const mhlw = await searchMhlwTsutatsu({ keyword, page: 0 });
    warnings.push(...mhlw.warnings);
    partialFailures.push(...mhlw.partialFailures);
    relatedTsutatsu.push(
      ...mhlw.results.slice(0, params.mhlwLimit ?? 5).map((result) => ({
        source_type: 'mhlw' as const,
        canonical_id: buildMhlwDocumentCanonicalId(result.dataId),
        title: result.title,
        source_url: `https://www.mhlw.go.jp/web/t_doc?dataId=${result.dataId}&dataType=1&pageNo=1`,
        retrieved_at: retrievedAt,
        warnings: [...mhlw.warnings],
        version_info: joinVersionInfo([result.date, result.shubetsu]),
        upstream_hash: computeUpstreamHash([result.dataId, result.title, result.date, result.shubetsu]),
        date: result.date,
        number: result.shubetsu,
      }))
    );

    if (params.includeJaish !== false) {
      const jaish = await searchJaishTsutatsu({
        keyword,
        limit: params.jaishLimit ?? 5,
        maxPages: params.jaishMaxPages ?? 5,
      });
      warnings.push(...jaish.warnings);
      partialFailures.push(...jaish.failedPages);
      relatedTsutatsu.push(
        ...jaish.results.map((result) => ({
          source_type: 'jaish' as const,
          canonical_id: buildJaishCanonicalId(result.url),
          title: result.title,
          source_url: result.url.startsWith('http') ? result.url : `https://www.jaish.gr.jp${result.url}`,
          retrieved_at: retrievedAt,
          warnings: [...jaish.warnings],
          version_info: joinVersionInfo([result.date, result.number]),
          upstream_hash: computeUpstreamHash([result.url, result.title, result.date, result.number]),
          date: result.date,
          number: result.number,
        }))
      );
    }
  }

  const dedupedRelated = dedupeEvidenceRecords(relatedTsutatsu).slice(0, 10);
  const status = partialFailures.length > 0 || warnings.some((warning) => warning.code !== 'DELEGATED_EVIDENCE_NOT_IMPLEMENTED')
    ? 'partial'
    : 'ok';

  return {
    status,
    primary_evidence: primaryEvidence,
    delegated_evidence: delegatedEvidence,
    related_tsutatsu: dedupedRelated,
    warnings: dedupeWarnings(warnings),
    partial_failures: dedupePartialFailures(partialFailures),
    search_keywords: keywords,
  };
}

function buildPrimaryTitle(lawTitle: string, article: string, paragraph?: number, item?: number): string {
  const rawArticle = article.replace(/_/g, 'の');
  const articleDisplay = /^第/.test(rawArticle) ? rawArticle : `第${rawArticle}条`;
  const paraDisplay = paragraph ? `第${paragraph}項` : '';
  const itemDisplay = item ? `第${item}号` : '';
  return `${lawTitle} ${articleDisplay}${paraDisplay}${itemDisplay}`;
}

function normalizeKeywords(explicitKeywords: string[] | undefined, inferredKeywords: string[]): string[] {
  const seed = explicitKeywords && explicitKeywords.length > 0
    ? explicitKeywords
    : inferredKeywords;

  return Array.from(new Set(seed.map((value) => value.trim()).filter(Boolean))).slice(0, 3);
}

function dedupeWarnings(warnings: WarningMessage[]): WarningMessage[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupePartialFailures(failures: PartialFailure[]): PartialFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.source}:${failure.target}:${failure.reason}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeEvidenceRecords(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.canonical_id)) {
      return false;
    }
    seen.add(record.canonical_id);
    return true;
  });
}
