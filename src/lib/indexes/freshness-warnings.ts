import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from './egov-index.js';
import { indexMetadataRegistry, inferFreshness } from './index-metadata.js';
import type { IndexSource } from './types.js';

export const BUNDLED_AGE_THRESHOLD_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUNDLED_AGE_THRESHOLD_MS = BUNDLED_AGE_THRESHOLD_DAYS * DAY_MS;

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

export function getBundledIndexWarnings(now: number = Date.now()): FreshnessWarning[] {
  const meta = getEgovIndexMeta();
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return [];
  const elapsedMs = now - generatedMs;
  if (elapsedMs <= BUNDLED_AGE_THRESHOLD_MS) return [];
  const ageDays = Math.floor(elapsedMs / DAY_MS);
  const message = `内蔵法令インデックスの生成から ${ageDays} 日経過しています（生成日: ${formatDate(generatedMs)}）。最新の法令改正を反映するには、Claude Desktop / Claude Code を再起動してください（\`npx -y\` 起動の場合は再起動で最新パッケージが自動取得されます）。グローバルインストール利用時は \`npm update -g jp-labor-evidence-mcp\` を実行してください。`;
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
