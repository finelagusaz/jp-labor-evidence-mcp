import { buildEgovArticleCanonicalId } from '../canonical-id.js';
import { computeUpstreamHash, joinVersionInfo } from '../evidence-metadata.js';
import type { WarningMessage } from '../types.js';
import { getArticleByLawId } from './law-service.js';

export interface DiffEvidenceRecord {
  source_type: 'egov';
  canonical_id: string;
  law_id: string;
  law_title: string;
  article: string;
  paragraph?: number;
  item?: number;
  title: string;
  body: string;
  source_url: string;
  retrieved_at: string;
  version_info?: string;
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

  const retrievedAt = new Date().toISOString();
  const baseEvidence = buildDiffEvidenceRecord(baseArticle, params.article, params.paragraph, params.item, retrievedAt);
  const headEvidence = buildDiffEvidenceRecord(headArticle, params.article, params.paragraph, params.item, retrievedAt);
  const diffChunks = computeDiffChunks(baseEvidence.body, headEvidence.body);
  const warnings: WarningMessage[] = [];

  if (baseEvidence.law_title !== headEvidence.law_title) {
    warnings.push({
      code: 'DIFFERENT_LAW_TITLES',
      message: `比較対象の法令名が異なります: ${baseEvidence.law_title} / ${headEvidence.law_title}`,
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

function buildDiffEvidenceRecord(
  article: Awaited<ReturnType<typeof getArticleByLawId>>,
  rawArticle: string,
  paragraph: number | undefined,
  item: number | undefined,
  retrievedAt: string,
): DiffEvidenceRecord {
  const normalizedArticle = rawArticle.replace(/_/g, 'の');
  const articleDisplay = /^第/.test(normalizedArticle) ? normalizedArticle : `第${normalizedArticle}条`;
  const paraDisplay = paragraph ? `第${paragraph}項` : '';
  const itemDisplay = item ? `第${item}号` : '';
  const title = `${article.lawTitle} ${articleDisplay}${paraDisplay}${itemDisplay}`;
  const body = `${article.articleCaption ? `（${article.articleCaption}）\n` : ''}${article.text}`;

  return {
    source_type: 'egov',
    canonical_id: buildEgovArticleCanonicalId(article.lawId, rawArticle, paragraph, item),
    law_id: article.lawId,
    law_title: article.lawTitle,
    article: rawArticle,
    paragraph,
    item,
    title,
    body,
    source_url: article.egovUrl,
    retrieved_at: retrievedAt,
    version_info: joinVersionInfo([article.lawNum, article.promulgationDate]),
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
