import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from './egov-index.js';
import { indexMetadataRegistry, inferFreshness } from './index-metadata.js';
import type { IndexSource } from './types.js';
import type { WarningMessage } from '../types.js';
import { DAY_MS } from './time.js';

export const BUNDLED_AGE_THRESHOLD_DAYS = 60;
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

/**
 * Formats a UTC ms timestamp as a `YYYY-MM-DD JST` calendar date in
 * Asia/Tokyo. Target users are 日本の社労士 / HR なので JST 表記が自然。
 * Shifting by the JST offset before reading the UTC date also fixes the
 * off-by-one on JST-midnight boundary timestamps (e.g. 4/1 / 10/1 施行日).
 */
function formatJstDate(ms: number): string {
  return `${new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10)} JST`;
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
    ? `（直近の労働法令改正施行日 ${formatJstDate(boundaryMs)} を跨いでいるため、4/1 / 10/1 施行改正が反映されていない可能性があります）`
    : '';
  const message = `内蔵法令インデックスの生成から ${ageDays} 日経過しています（生成日: ${formatJstDate(generatedMs)}）${boundaryNote}。なお条文の本文は常に最新の現行版をオンライン取得するため、本文の更新に再起動は不要です。この警告が対象とするのは内蔵の法令リスト（法令名・略称から法令を特定するための対応表）で、新しく制定・改称された法令を検索できるようにするには Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動なら再起動で最新パッケージを自動取得。グローバルインストールは \`npm update -g jp-labor-evidence-mcp\`）。`;
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
  const message = `${label}のインデックスが古くなっています（最終同期: ${formatJstDate(generatedMs)}、${ageDays}日前）。同じキーワードで再検索すると最新の情報が反映されます。`;
  return [{ code: 'RUNTIME_INDEX_STALE', source, message }];
}

const SUPPRESS_FRESHNESS_ENV = 'LABOR_LAW_MCP_SUPPRESS_FRESHNESS_WARNINGS';
const FALSY_ENV_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Whether freshness warnings are suppressed via the
 * `LABOR_LAW_MCP_SUPPRESS_FRESHNESS_WARNINGS` env var. Enabled for any value
 * other than '' / '0' / 'false' / 'no' / 'off' (case-insensitive).
 *
 * Intended for intentionally-frozen bundles — historical-case reproduction,
 * pinned regression environments, deliberate offline operation — where
 * staleness warnings are noise. When enabled, both the startup notification
 * (`emitStartupWarnings`) and the per-tool-response merge
 * (`getIndexWarningsForTool`) are skipped. The low-level getters
 * (`getBundledIndexWarnings` / `getRuntimeIndexWarnings`) stay pure so a status
 * resource can still surface the true state.
 */
export function isFreshnessWarningsSuppressed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env[SUPPRESS_FRESHNESS_ENV];
  if (raw === undefined) return false;
  return !FALSY_ENV_VALUES.has(raw.trim().toLowerCase());
}

export function getIndexWarningsForTool(
  sources: ReadonlyArray<IndexSource>,
  now: number = Date.now()
): FreshnessWarning[] {
  if (isFreshnessWarningsSuppressed()) return [];
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

/**
 * Strips the internal `source` field so a `FreshnessWarning` matches the
 * `WarningMessage` ({code, message}) shape carried on tool envelopes. Centralised
 * so a future `WarningMessage` shape change touches one place, not every handler.
 */
export function toWireWarnings(warnings: FreshnessWarning[]): WarningMessage[] {
  return warnings.map(({ code, message }) => ({ code, message }));
}

export async function emitStartupWarnings(
  server: McpServer,
  now: number = Date.now()
): Promise<void> {
  if (isFreshnessWarningsSuppressed()) return;
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
