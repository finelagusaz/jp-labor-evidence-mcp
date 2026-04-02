import { buildEgovArticleCanonicalId, buildMhlwDocumentCanonicalId, buildJaishCanonicalId } from '../canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../evidence-metadata.js';
import type { PartialFailure, WarningMessage } from '../types.js';
import { ExternalApiError, ParseError } from '../errors.js';
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
  matched_signals?: MatchSignal[];
  relevance_reason?: string;
}

export interface MatchSignal {
  type: 'law_title' | 'article_ref' | 'heading' | 'body_keyword' | 'source_priority';
  value: string;
  weight: number;
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
    try {
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
    } catch (error) {
      const failure = mapRelatedSourceFailure('egov', `toc:${delegatedLaw.lawId}`, error);
      warnings.push(failure.warning);
      partialFailures.push(failure.partialFailure);
    }
  }

  for (const keyword of keywords) {
    try {
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
            lawTitle: primary.lawTitle,
            article: params.article,
            articleCaption: primary.articleCaption,
            keywords,
          })
        )
      );
    } catch (error) {
      const failure = mapRelatedSourceFailure('mhlw', `search:${keyword}`, error);
      warnings.push(failure.warning);
      partialFailures.push(failure.partialFailure);
    }

    if (params.includeJaish !== false) {
      try {
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
              lawTitle: primary.lawTitle,
              article: params.article,
              articleCaption: primary.articleCaption,
              keywords,
            })
          )
        );
      } catch (error) {
        const failure = mapRelatedSourceFailure('jaish', `search:${keyword}`, error);
        warnings.push(failure.warning);
        partialFailures.push(failure.partialFailure);
      }
    }
  }

  const dedupedRelated = dedupeEvidenceRecords(relatedTsutatsu)
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
    .slice(0, 10);
  const status = partialFailures.length > 0
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

function mapRelatedSourceFailure(
  source: 'egov' | 'mhlw' | 'jaish',
  target: string,
  error: unknown,
): { warning: WarningMessage; partialFailure: PartialFailure } {
  const reason =
    error instanceof ExternalApiError ? 'upstream_unavailable' :
    error instanceof ParseError ? 'parse_error' :
    error instanceof Error ? error.name :
    'unknown_error';
  const message =
    error instanceof Error ? error.message : '関連情報の取得に失敗しました。';

  return {
    warning: {
      code: `${source.toUpperCase()}_RELATED_SOURCE_FAILED`,
      message: `${source} の関連情報取得に失敗しました: ${message}`,
    },
    partialFailure: {
      source,
      target,
      reason,
    },
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
  lawTitle: string;
  article: string;
  articleCaption?: string;
  keywords: string[];
}): EvidenceRecord {
  const signals = collectMatchSignals({
    scoringText: params.scoringText,
    sourceType: params.sourceType,
    lawTitle: params.lawTitle,
    article: params.article,
    articleCaption: params.articleCaption,
    keywords: params.keywords,
  });
  const score = computeRelevanceScore(signals);
  const matchedKeywords = signals
    .filter((signal) => signal.type === 'body_keyword')
    .map((signal) => signal.value);

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
    matched_signals: signals,
    relevance_reason: describeRelevance(params.sourceType, signals, score),
  };
}

function collectMatchSignals(params: {
  scoringText: string;
  sourceType: 'mhlw' | 'jaish';
  lawTitle: string;
  article: string;
  articleCaption?: string;
  keywords: string[];
}): MatchSignal[] {
  const signals: MatchSignal[] = [];
  const articleRefs = buildArticleReferenceCandidates(params.article);

  signals.push({
    type: 'source_priority',
    value: params.sourceType === 'mhlw' ? 'mhlw' : 'jaish',
    weight: params.sourceType === 'mhlw' ? 0.12 : 0.08,
  });

  if (params.scoringText.includes(params.lawTitle)) {
    signals.push({
      type: 'law_title',
      value: params.lawTitle,
      weight: 0.4,
    });
  }

  for (const articleRef of articleRefs) {
    if (params.scoringText.includes(articleRef)) {
      signals.push({
        type: 'article_ref',
        value: articleRef,
        weight: 0.25,
      });
      break;
    }
  }

  if (params.articleCaption && params.scoringText.includes(params.articleCaption)) {
    signals.push({
      type: 'heading',
      value: params.articleCaption,
      weight: 0.22,
    });
  }

  for (const keyword of params.keywords) {
    if (!params.scoringText.includes(keyword)) {
      continue;
    }
    signals.push({
      type: 'body_keyword',
      value: keyword,
      weight: 0.12,
    });
  }

  return dedupeSignals(signals);
}

function computeRelevanceScore(signals: MatchSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    score += signal.weight;
  }
  return Number(Math.min(0.99, score).toFixed(2));
}

function describeRelevance(
  sourceType: 'mhlw' | 'jaish',
  signals: MatchSignal[],
  score: number,
): string {
  const sourceLabel = sourceType === 'jaish' ? 'JAISH 安衛通達検索' : '厚労省通達検索';
  const reasonParts = signals
    .filter((signal) => signal.type !== 'source_priority')
    .map((signal) => {
      switch (signal.type) {
        case 'law_title':
          return `法令名一致(${signal.value})`;
        case 'article_ref':
          return `条番号一致(${signal.value})`;
        case 'heading':
          return `見出し一致(${signal.value})`;
        case 'body_keyword':
          return `本文語一致(${signal.value})`;
        default:
          return null;
      }
    })
    .filter((value): value is string => value !== null);

  if (reasonParts.length === 0) {
    return `${sourceLabel} の候補。明示的な一致信号は弱いが、source 優先度により採用。score=${score}`;
  }
  return `${sourceLabel} で ${reasonParts.join(' / ')}。score=${score}`;
}

function buildArticleReferenceCandidates(article: string): string[] {
  const normalized = article.replace(/_/g, 'の').replace(/^第/, '').replace(/条$/, '');
  const candidates = [
    `第${normalized}条`,
    `${normalized}条`,
    normalized,
  ];
  return Array.from(new Set(candidates));
}

function dedupeSignals(signals: MatchSignal[]): MatchSignal[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.type}:${signal.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
