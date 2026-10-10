import { buildRevisionMetadata, buildVersionInfoString, computeUpstreamHash, getRevisionWarnings } from '../evidence-metadata.js';
import { ValidationError } from '../errors.js';
import type { RevisionMetadata, WarningMessage } from '../types.js';
import { getArticleByLawId, verifyLatestEnforced } from './law-service.js';
import { formatArticleBody } from '../egov-parser.js';
import { buildArticleCanonicalId, buildArticleTitle } from '../article-locator.js';

export interface DiffEvidenceRecord {
  source_type: 'egov';
  canonical_id: string;
  law_id: string;
  /** 版の ID（law_revision_id）で指定した側だけ */
  law_revision_id?: string;
  law_title: string;
  article: string;
  paragraph?: number;
  item?: number;
  title: string;
  body: string;
  source_url: string;
  retrieved_at: string;
  version_info?: string;
  revision_metadata?: RevisionMetadata;
  upstream_hash: string;
}

export interface DiffChunk {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface RevisionDiffSummary {
  changed: boolean;
  inserted_chunks: number;
  deleted_chunks: number;
  unchanged_chunks: number;
}

export interface DiffRevisionResult {
  status: 'ok';
  base_evidence: DiffEvidenceRecord;
  head_evidence: DiffEvidenceRecord;
  summary: RevisionDiffSummary;
  diff_chunks: DiffChunk[];
  warnings: WarningMessage[];
}

export async function diffRevision(params: {
  baseLawId: string;
  headLawId: string;
  article: string;
  paragraph?: number;
  item?: number;
}): Promise<DiffRevisionResult> {
  const [baseArticle, headArticle] = await Promise.all([
    getArticleByLawId({
      lawId: params.baseLawId,
      article: params.article,
      paragraph: params.paragraph,
      item: params.item,
    }),
    getArticleByLawId({
      lawId: params.headLawId,
      article: params.article,
      paragraph: params.paragraph,
      item: params.item,
    }),
  ]);

  // 題名は改正で変わりうるので、同じ法令かは law_id で判定する（題名の一致も従来どおり認める）
  if (baseArticle.lawId !== headArticle.lawId && baseArticle.lawTitle !== headArticle.lawTitle) {
    throw new ValidationError(
      `diff_revision は同一法令の改正前後比較のみ対応です: ${baseArticle.lawTitle} / ${headArticle.lawTitle}`
    );
  }

  const [baseVerified, headVerified] = await Promise.all([
    verifyLatestEnforced(baseArticle.lawId, baseArticle.revisionInfo),
    verifyLatestEnforced(headArticle.lawId, headArticle.revisionInfo),
  ]);
  const retrievedAt = new Date().toISOString();
  const baseEvidence = buildDiffEvidenceRecord(baseArticle, params.article, params.paragraph, params.item, retrievedAt, baseVerified);
  const headEvidence = buildDiffEvidenceRecord(headArticle, params.article, params.paragraph, params.item, retrievedAt, headVerified);

  const diffChunks = computeDiffChunks(baseEvidence.body, headEvidence.body);
  // 両側とも同じ法令名で始まるので、どちらの側の警告かを前に付ける
  const warnings: WarningMessage[] = [
    ...sideWarnings('比較元', baseArticle, baseVerified),
    ...sideWarnings('比較先', headArticle, headVerified),
  ];
  if (baseEvidence.paragraph !== headEvidence.paragraph) {
    warnings.push({
      code: 'DIFF_PARAGRAPH_MISMATCH',
      message: `改正前は第${baseEvidence.paragraph ?? '?'}項、改正後は第${headEvidence.paragraph ?? '?'}項の号を比べています（paragraph を省いたため、号を含む項を版ごとに特定しました）。同じ項どうしを比べるには paragraph を指定してください。`,
    });
  }

  return {
    status: 'ok',
    base_evidence: baseEvidence,
    head_evidence: headEvidence,
    summary: {
      changed: diffChunks.some((chunk) => chunk.type !== 'equal'),
      inserted_chunks: diffChunks.filter((chunk) => chunk.type === 'insert').length,
      deleted_chunks: diffChunks.filter((chunk) => chunk.type === 'delete').length,
      unchanged_chunks: diffChunks.filter((chunk) => chunk.type === 'equal').length,
    },
    diff_chunks: diffChunks,
    warnings,
  };
}

type FetchedArticle = Awaited<ReturnType<typeof getArticleByLawId>>;

function sideWarnings(side: string, article: FetchedArticle, latestEnforcedVerified: boolean): WarningMessage[] {
  return getRevisionWarnings(article.revisionInfo, article.lawTitle, { latestEnforcedVerified })
    .map((warning) => ({ ...warning, message: `${side}: ${warning.message}` }));
}

function buildDiffEvidenceRecord(
  article: FetchedArticle,
  rawArticle: string,
  paragraph: number | undefined,
  item: number | undefined,
  retrievedAt: string,
  latestEnforcedVerified: boolean,
): DiffEvidenceRecord {
  // paragraph を省いた号は版ごとに項を特定するので、特定した項を使う
  const resolvedParagraph = article.paragraph ?? paragraph;
  const locator = { article: rawArticle, paragraph: resolvedParagraph, item };
  const title = buildArticleTitle(article.lawTitle, locator);
  const body = formatArticleBody(article);
  const pinned = article.lawRevisionId !== undefined;

  return {
    source_type: 'egov',
    // 版を指定した側は、同じ条の別の版と区別できるよう版の ID で識別する
    canonical_id: buildArticleCanonicalId(article.lawRevisionId ?? article.lawId, locator),
    law_id: article.lawId,
    law_revision_id: article.lawRevisionId,
    law_title: article.lawTitle,
    article: rawArticle,
    paragraph: resolvedParagraph,
    item,
    title,
    body,
    source_url: article.egovUrl,
    retrieved_at: retrievedAt,
    version_info: buildVersionInfoString(article.lawNum, article.promulgationDate, article.revisionInfo, { pinned }),
    revision_metadata: buildRevisionMetadata(article.revisionInfo, { latestEnforcedVerified }),
    upstream_hash: computeUpstreamHash([article.lawId, title, body, article.egovUrl]),
  };
}

function computeDiffChunks(baseBody: string, headBody: string): DiffChunk[] {
  const baseLines = normalizeLines(baseBody);
  const headLines = normalizeLines(headBody);
  const table = buildLcsTable(baseLines, headLines);
  const chunks = backtrackDiff(baseLines, headLines, table);
  return mergeAdjacentChunks(chunks);
}

function normalizeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildLcsTable(baseLines: string[], headLines: string[]): number[][] {
  const table = Array.from({ length: baseLines.length + 1 }, () =>
    Array.from({ length: headLines.length + 1 }, () => 0)
  );

  for (let i = baseLines.length - 1; i >= 0; i -= 1) {
    for (let j = headLines.length - 1; j >= 0; j -= 1) {
      if (baseLines[i] === headLines[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  return table;
}

function backtrackDiff(baseLines: string[], headLines: string[], table: number[][]): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let i = 0;
  let j = 0;

  while (i < baseLines.length && j < headLines.length) {
    if (baseLines[i] === headLines[j]) {
      chunks.push({ type: 'equal', text: baseLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      chunks.push({ type: 'delete', text: baseLines[i] });
      i += 1;
    } else {
      chunks.push({ type: 'insert', text: headLines[j] });
      j += 1;
    }
  }

  while (i < baseLines.length) {
    chunks.push({ type: 'delete', text: baseLines[i] });
    i += 1;
  }

  while (j < headLines.length) {
    chunks.push({ type: 'insert', text: headLines[j] });
    j += 1;
  }

  return chunks;
}

function mergeAdjacentChunks(chunks: DiffChunk[]): DiffChunk[] {
  const merged: DiffChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && previous.type === chunk.type) {
      previous.text = `${previous.text}\n${chunk.text}`;
      continue;
    }
    merged.push({ ...chunk });
  }

  return merged;
}
