import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from './egov-index.js';
import { indexMetadataRegistry, inferFreshness } from './index-metadata.js';
import type { IndexSource } from './types.js';

export const BUNDLED_AGE_THRESHOLD_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUNDLED_AGE_THRESHOLD_MS = BUNDLED_AGE_THRESHOLD_DAYS * DAY_MS;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type FreshnessWarning = {
  code: 'BUNDLED_INDEX_AGED' | 'RUNTIME_INDEX_STALE';
  source: IndexSource;
  message: string;
};

const SOURCE_LABELS: Record<'mhlw' | 'jaish', string> = {
  mhlw: '厚生労働省通達',
  jaish: '中央労働災害防止協会（JAISH）判例・資料',
};

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Returns the UTC ms timestamp of the most recent 4/1 00:00 JST or 10/1 00:00 JST
 * boundary that is `<= now`.
 *
 * Used to detect whether a bundled index was generated before a major Japanese
 * labor-law revision boundary that the current time has already crossed.
 *
 * Semantic: the returned boundary is always `<= now`. Combined with a strict
 * `generatedMs < boundary` comparison upstream, an `equals` boundary case
 * cleanly counts as "not crossed".
 */
export function getMostRecentLawRevisionBoundaryMs(now: number): number {
  const jstNow = new Date(now + JST_OFFSET_MS);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() + 1;
  const jstMidnightUtc = (y: number, m: number, d: number) =>
    Date.UTC(y, m - 1, d) - JST_OFFSET_MS;
  if (month >= 10) return jstMidnightUtc(year, 10, 1);
  if (month >= 4) return jstMidnightUtc(year, 4, 1);
  return jstMidnightUtc(year - 1, 10, 1);
}

export function getBundledIndexWarnings(now: number = Date.now()): FreshnessWarning[] {
  const meta = getEgovIndexMeta();
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return [];
  const elapsedMs = now - generatedMs;
  const boundaryMs = getMostRecentLawRevisionBoundaryMs(now);
  const crossedBoundary = generatedMs < boundaryMs;
  const aged = elapsedMs > BUNDLED_AGE_THRESHOLD_MS;
  if (!aged && !crossedBoundary) return [];
  const ageDays = Math.floor(elapsedMs / DAY_MS);
  const boundaryNote = crossedBoundary
    ? `（直近の労働法令改正施行日 ${formatDate(boundaryMs)} を跨いでいるため、4/1 / 10/1 施行改正が反映されていない可能性があります）`
    : '';
  const message = `内蔵法令インデックスの生成から ${ageDays} 日経過しています（生成日: ${formatDate(generatedMs)}）${boundaryNote}。最新の法令改正を反映するには、Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動の場合は再起動で最新パッケージが自動取得されます）。グローバルインストール利用時は \`npm update -g jp-labor-evidence-mcp\` を実行してください。`;
  return [{ code: 'BUNDLED_INDEX_AGED', source: 'egov', message }];
}

export function getRuntimeIndexWarnings(
  source: 'mhlw' | 'jaish',
  now: number = Date.now()
): FreshnessWarning[] {
  const meta = indexMetadataRegistry.list().find((m) => m.source === source);
  if (!meta) return [];
  const freshness = inferFreshness(meta.generated_at, now);
  if (freshness !== 'stale') return [];
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return [];
  const ageDays = Math.floor((now - generatedMs) / DAY_MS);
  const label = SOURCE_LABELS[source];
  const message = `${label}のインデックスが古くなっています（最終同期: ${formatDate(generatedMs)}、${ageDays}日前）。同じキーワードで再検索すると最新の情報が反映されます。`;
  return [{ code: 'RUNTIME_INDEX_STALE', source, message }];
}

export function getIndexWarningsForTool(
  sources: ReadonlyArray<IndexSource>,
  now: number = Date.now()
): FreshnessWarning[] {
  const warnings: FreshnessWarning[] = [];
  for (const source of sources) {
    if (source === 'egov') {
      warnings.push(...getBundledIndexWarnings(now));
    } else {
      warnings.push(...getRuntimeIndexWarnings(source, now));
    }
  }
  return warnings;
}

export async function emitStartupWarnings(
  server: McpServer,
  now: number = Date.now()
): Promise<void> {
  const warnings = getBundledIndexWarnings(now);
  if (warnings.length === 0) return;
  for (const warning of warnings) {
    console.error(`[jp-labor-evidence-mcp] WARNING: ${warning.message}`);
    try {
      await server.sendLoggingMessage({
        level: 'warning',
        data: warning.message,
        logger: 'jp-labor-evidence-mcp',
      });
    } catch {
      // MCP client may not support logging capability; stderr already written
    }
  }
}
