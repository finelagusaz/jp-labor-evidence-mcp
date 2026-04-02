import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { observabilityRegistry } from '../lib/observability.js';
import { createToolEnvelopeSchema, createToolResult, isoNow } from '../lib/tool-contract.js';

const outputSchema = createToolEnvelopeSchema(
  z.object({
    retrieved_at: z.string(),
    started_at: z.string(),
    degraded: z.boolean(),
    degraded_sources: z.array(z.string()),
    degraded_reasons: z.array(z.object({
      source: z.string(),
      code: z.string(),
      message: z.string(),
    })),
    caches: z.array(z.object({
      name: z.string(),
      kind: z.enum(['raw', 'normalized']),
      hits: z.number(),
      misses: z.number(),
      writes: z.number(),
      evictions: z.number(),
      size: z.number(),
      estimated_bytes: z.number(),
      hit_rate: z.number(),
    })),
    tools: z.array(z.object({
      tool: z.string(),
      calls: z.number(),
      successes: z.number(),
      errors: z.number(),
      partials: z.number(),
      not_found: z.number(),
      invalid: z.number(),
      avg_latency_ms: z.number(),
      error_rate: z.number(),
    })),
    upstreams: z.array(z.object({
      source: z.string(),
      requests: z.number(),
      successes: z.number(),
      failures: z.number(),
      timeouts: z.number(),
      parse_errors: z.number(),
      circuit_open_rejections: z.number(),
      total_latency_ms: z.number(),
      avg_latency_ms: z.number(),
      failure_rate: z.number(),
    })),
    indexes: z.array(z.object({
      source: z.enum(['egov', 'mhlw', 'jaish']),
      generated_at: z.string(),
      last_success_at: z.string().optional(),
      last_failure_at: z.string().optional(),
      freshness: z.enum(['fresh', 'stale', 'unknown']),
      entry_count: z.number(),
      coverage_ratio: z.number().optional(),
      covered_years: z.array(z.number()).optional(),
      query_hit_rate: z.number().optional(),
      last_sync_scope: z.string().optional(),
      cold_start_minimum_scope: z.string().optional(),
      storage_path: z.string().optional(),
      snapshot_id: z.string().optional(),
      active_snapshot_id: z.string().optional(),
      last_promotion_at: z.string().optional(),
      last_known_good_at: z.string().optional(),
      rollback_count: z.number().optional(),
    })),
    partial_failures: z.record(z.string(), z.number()),
  })
);

export function registerGetObservabilitySnapshotTool(server: McpServer) {
  server.registerTool(
    'get_observability_snapshot',
    {
      description: 'upstream 成功率、parse error、cache hit rate、partial failure を集計した観測スナップショットを返す。',
      outputSchema,
    },
    async () => {
      const startedAt = Date.now();
      const snapshot = observabilityRegistry.snapshot();
      const envelope = {
        status: 'ok' as const,
        retryable: false,
        degraded: snapshot.degraded,
        warnings: [],
        partial_failures: [],
        data: {
          retrieved_at: isoNow(),
          started_at: snapshot.started_at,
          degraded: snapshot.degraded,
          degraded_sources: snapshot.degraded_sources,
          degraded_reasons: snapshot.degraded_reasons,
          caches: snapshot.caches,
          tools: snapshot.tools,
          upstreams: snapshot.upstreams,
          indexes: snapshot.indexes,
          partial_failures: snapshot.partial_failures,
        },
      };

      const cacheLines = snapshot.caches.map((cache) =>
        `- ${cache.kind}:${cache.name}: hit_rate=${cache.hit_rate}, size=${cache.size}, bytes≈${cache.estimated_bytes}`
      );
      const upstreamLines = snapshot.upstreams.map((upstream) =>
        `- ${upstream.source}: requests=${upstream.requests}, failure_rate=${upstream.failure_rate}, parse_errors=${upstream.parse_errors}, timeouts=${upstream.timeouts}`
      );
      const indexLines = snapshot.indexes.map((index) =>
        `- ${index.source}: freshness=${index.freshness}, entries=${index.entry_count}, coverage=${index.coverage_ratio ?? '-'}, covered_years=${index.covered_years?.join(',') ?? '-'}, query_hit_rate=${index.query_hit_rate ?? '-'}, scope=${index.last_sync_scope ?? '-'}, cold_start=${index.cold_start_minimum_scope ?? '-'}, snapshot=${index.snapshot_id ?? '-'}, active=${index.active_snapshot_id ?? '-'}, promoted_at=${index.last_promotion_at ?? '-'}, last_known_good_at=${index.last_known_good_at ?? '-'}, rollback_count=${index.rollback_count ?? 0}, path=${index.storage_path ?? '-'}`
      );

      return createToolResult(
        'get_observability_snapshot',
        envelope,
        `# Observability Snapshot\n\n状態: ${snapshot.degraded ? 'degraded' : 'ok'}\n\n## Caches\n${cacheLines.join('\n') || '- なし'}\n\n## Upstreams\n${upstreamLines.join('\n') || '- なし'}\n\n## Indexes\n${indexLines.join('\n') || '- なし'}`,
        startedAt,
      );
    }
  );
}
