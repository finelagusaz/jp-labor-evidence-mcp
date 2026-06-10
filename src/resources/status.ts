/**
 * MCP リソース: サーバー状態 / freshness
 *
 * freshness 警告は logging notification と tool envelope の 2 経路に依存する
 * reactive な設計。本リソースは「今この server の index 状態を教えて」と
 * on-demand で照会できる proactive な経路を提供し、discoverability と
 * テスタビリティを高める。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEgovIndexMeta } from '../lib/indexes/egov-index.js';
import { indexMetadataRegistry } from '../lib/indexes/index-metadata.js';
import { computeBundledAgeDays } from '../lib/indexes/time.js';
import {
  getBundledIndexWarnings,
  getRuntimeIndexWarnings,
  isFreshnessWarningsSuppressed,
  type FreshnessWarning,
} from '../lib/indexes/freshness-warnings.js';

export const STATUS_RESOURCE_URI = 'mcp://jp-labor-evidence-mcp/status';

type IndexStatus = {
  generated_at: string;
  freshness: string;
  bundled_age_days?: number;
  warning_code?: string;
};

export type ServerStatus = {
  package_version: string;
  generated_at: string;
  freshness_warnings_suppressed: boolean;
  indexes: {
    egov: IndexStatus;
    mhlw: IndexStatus | null;
    jaish: IndexStatus | null;
  };
  active_warnings: FreshnessWarning[];
};

function runtimeIndexStatus(
  source: 'mhlw' | 'jaish',
  warningBySource: Map<string, FreshnessWarning>,
): IndexStatus | null {
  const meta = indexMetadataRegistry.list().find((m) => m.source === source);
  if (!meta) return null;
  const status: IndexStatus = {
    generated_at: meta.generated_at,
    freshness: meta.freshness,
  };
  const warning = warningBySource.get(source);
  if (warning) status.warning_code = warning.code;
  return status;
}

/**
 * Builds the status payload as a pure function of `now` (the egov age is
 * recomputed from the injected `now` rather than read off
 * `getEgovIndexMeta().bundled_age_days`, which is wall-clock based). The
 * `active_warnings` list reflects the *true* freshness state even when warnings
 * are suppressed for tool responses (see `isFreshnessWarningsSuppressed`).
 */
export function buildServerStatus(
  packageVersion: string,
  now: number = Date.now(),
): ServerStatus {
  const activeWarnings: FreshnessWarning[] = [
    ...getBundledIndexWarnings(now),
    ...getRuntimeIndexWarnings('mhlw', now),
    ...getRuntimeIndexWarnings('jaish', now),
  ];
  const warningBySource = new Map<string, FreshnessWarning>(
    activeWarnings.map((w) => [w.source, w]),
  );

  const egovMeta = getEgovIndexMeta();
  const egov: IndexStatus = {
    generated_at: egovMeta.generated_at,
    freshness: egovMeta.freshness,
  };
  const egovAgeDays = computeBundledAgeDays(egovMeta.generated_at, now);
  if (egovAgeDays !== undefined) egov.bundled_age_days = egovAgeDays;
  const egovWarning = warningBySource.get('egov');
  if (egovWarning) egov.warning_code = egovWarning.code;

  return {
    package_version: packageVersion,
    generated_at: new Date(now).toISOString(),
    freshness_warnings_suppressed: isFreshnessWarningsSuppressed(),
    indexes: {
      egov,
      mhlw: runtimeIndexStatus('mhlw', warningBySource),
      jaish: runtimeIndexStatus('jaish', warningBySource),
    },
    active_warnings: activeWarnings,
  };
}

export function registerStatusResource(server: McpServer, packageVersion: string): void {
  server.registerResource(
    'status',
    STATUS_RESOURCE_URI,
    {
      title: 'サーバー状態 / freshness',
      description:
        '内蔵法令インデックス（egov）と通達／判例インデックス（mhlw / jaish）の generated_at・freshness・経過日数、現在有効な freshness 警告、package version を返す読み取り専用リソース。',
      mimeType: 'application/json',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(buildServerStatus(packageVersion), null, 2),
        },
      ],
    }),
  );
}
