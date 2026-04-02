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
  relevance_score?: number;
  matched_keywords?: string[];
  relevance_reason?: string;
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
  const inferredKeywords = [
    ...related.searchKeywords,
    ...extractKeywordCandidates(primaryBody),
  ];
  const keywords = normalizeKeywords(params.relatedKeywords, inferredKeywords);
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
      ...mhlw.results.slice(0, params.mhlwLimit ?? 5).map((result) =>
        buildRelatedTsutatsuCandidate({
          sourceType: 'mhlw',
          canonicalId: buildMhlwDocumentCanonicalId(result.dataId),
          title: result.title,
          sourceUrl: `https://www.mhlw.go.jp/web/t_doc?dataId=${result.dataId}&dataType=1&pageNo=1`,
          retrievedAt,
          warnings: [...mhlw.warnings],
          versionInfo: joinVersionInfo([result.date, result.shubetsu]),
          upstreamHash: computeUpstreamHash([result.dataId, result.title, result.date, result.shubetsu]),
          date: result.date,
          number: result.shubetsu,
          scoringText: `${result.title} ${result.shubetsu} ${result.date}`,
          keywords,
        })
      )
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
        ...jaish.results.map((result) =>
          buildRelatedTsutatsuCandidate({
            sourceType: 'jaish',
            canonicalId: buildJaishCanonicalId(result.url),
            title: result.title,
            sourceUrl: result.url.startsWith('http') ? result.url : `https://www.jaish.gr.jp${result.url}`,
            retrievedAt,
            warnings: [...jaish.warnings],
            versionInfo: joinVersionInfo([result.date, result.number]),
            upstreamHash: computeUpstreamHash([result.url, result.title, result.date, result.number]),
            date: result.date,
            number: result.number,
            scoringText: `${result.title} ${result.number} ${result.date}`,
            keywords,
          })
        )
      );
    }
  }

  const dedupedRelated = dedupeEvidenceRecords(relatedTsutatsu)
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
    .slice(0, 10);
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

function extractKeywordCandidates(text: string): string[] {
  const compact = text.replace(/\s+/g, '');
  const rawMatches = compact.match(/[一-龠々]{2,8}/g) ?? [];
  const stopwords = new Set([
    '労働者', '使用者', '事業者', '場合', '事項', '政令', '厚生労働省令',
    '命令', '必要', '定める', '行う', '関する', '及び', '又は', 'その他',
  ]);

  const keywords: string[] = [];
  for (const match of rawMatches) {
    if (stopwords.has(match)) {
      continue;
    }
    if (keywords.includes(match)) {
      continue;
    }
    keywords.push(match);
    if (keywords.length >= 3) {
      break;
    }
  }

  return keywords;
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

function buildRelatedTsutatsuCandidate(params: {
  sourceType: 'mhlw' | 'jaish';
  canonicalId: string;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  warnings: WarningMessage[];
  versionInfo?: string;
  upstreamHash: string;
  date?: string;
  number?: string;
  scoringText: string;
  keywords: string[];
}): EvidenceRecord {
  const score = computeRelevanceScore(params.scoringText, params.keywords, params.sourceType);
  const matchedKeywords = params.keywords.filter((keyword) => params.scoringText.includes(keyword));

  return {
    source_type: params.sourceType,
    canonical_id: params.canonicalId,
    title: params.title,
    source_url: params.sourceUrl,
    retrieved_at: params.retrievedAt,
    warnings: params.warnings,
    version_info: params.versionInfo,
    upstream_hash: params.upstreamHash,
    date: params.date,
    number: params.number,
    relevance_score: score,
    matched_keywords: matchedKeywords,
    relevance_reason: describeRelevance(params.sourceType, matchedKeywords, score),
  };
}

function computeRelevanceScore(
  scoringText: string,
  keywords: string[],
  sourceType: 'mhlw' | 'jaish',
): number {
  let score = sourceType === 'jaish' ? 0.45 : 0.4;
  for (const keyword of keywords) {
    if (scoringText.includes(keyword)) {
      score += 0.2;
    }
  }
  return Number(Math.min(0.99, score).toFixed(2));
}

function describeRelevance(
  sourceType: 'mhlw' | 'jaish',
  matchedKeywords: string[],
  score: number,
): string {
  const sourceLabel = sourceType === 'jaish' ? 'JAISH 安衛通達検索' : '厚労省通達検索';
  if (matchedKeywords.length === 0) {
    return `${sourceLabel} の候補。明示キーワード一致は弱いが、関連検索結果に含まれたため採用。score=${score}`;
  }
  return `${sourceLabel} で ${matchedKeywords.join('、')} に一致。score=${score}`;
}
