import { indexMetadataRegistry } from './indexes/index-metadata.js';
import type { IndexSnapshotMeta } from './indexes/types.js';

export interface CacheMetricsSnapshot {
  name: string;
  kind: 'raw' | 'normalized';
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
  estimated_bytes: number;
  hit_rate: number;
}

export interface ToolMetricsSnapshot {
  tool: string;
  calls: number;
  successes: number;
  errors: number;
  partials: number;
  not_found: number;
  invalid: number;
  avg_latency_ms: number;
  error_rate: number;
}

export interface UpstreamMetricsSnapshot {
  source: string;
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  parse_errors: number;
  circuit_open_rejections: number;
  total_latency_ms: number;
  avg_latency_ms: number;
  failure_rate: number;
}

export interface DegradedReason {
  source: string;
  code: string;
  message: string;
}

type CacheMetricsState = {
  kind: 'raw' | 'normalized';
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
  estimatedBytes: number;
};

type ToolMetricsState = {
  calls: number;
  successes: number;
  errors: number;
  partials: number;
  notFound: number;
  invalid: number;
  totalLatencyMs: number;
};

type UpstreamMetricsState = {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  parseErrors: number;
  circuitOpenRejections: number;
  totalLatencyMs: number;
};

class ObservabilityRegistry {
  private readonly startedAt = new Date().toISOString();
  private readonly cacheMetrics = new Map<string, CacheMetricsState>();
  private readonly toolMetrics = new Map<string, ToolMetricsState>();
  private readonly upstreamMetrics = new Map<string, UpstreamMetricsState>();
  private readonly partialFailures = new Map<string, number>();

  recordCacheHit(name: string, kind: 'raw' | 'normalized'): void {
    this.ensureCache(name, kind).hits += 1;
  }

  recordCacheMiss(name: string, kind: 'raw' | 'normalized'): void {
    this.ensureCache(name, kind).misses += 1;
  }

  recordCacheWrite(name: string, kind: 'raw' | 'normalized', size: number, entries: number): void {
    const metrics = this.ensureCache(name, kind);
    metrics.writes += 1;
    metrics.size = entries;
    metrics.estimatedBytes = size;
  }

  recordCacheEviction(name: string, kind: 'raw' | 'normalized', entries: number, size: number): void {
    const metrics = this.ensureCache(name, kind);
    metrics.evictions += 1;
    metrics.size = entries;
    metrics.estimatedBytes = size;
  }

  recordUpstreamRequest(source: string, latencyMs: number, outcome: 'success' | 'failure'): void {
    const metrics = this.ensureUpstream(source);
    metrics.requests += 1;
    metrics.totalLatencyMs += latencyMs;
    if (outcome === 'success') {
      metrics.successes += 1;
    } else {
      metrics.failures += 1;
    }
  }

  recordTimeout(source: string): void {
    this.ensureUpstream(source).timeouts += 1;
  }

  recordParseError(source: string): void {
    this.ensureUpstream(source).parseErrors += 1;
  }

  recordCircuitOpen(source: string): void {
    this.ensureUpstream(source).circuitOpenRejections += 1;
  }

  recordPartialFailure(source: string, count = 1): void {
    this.partialFailures.set(source, (this.partialFailures.get(source) ?? 0) + count);
  }

  recordToolCall(
    tool: string,
    latencyMs: number,
    outcome: {
      isError: boolean;
      status?: 'ok' | 'partial' | 'not_found' | 'unavailable' | 'invalid';
    },
  ): void {
    const metrics = this.ensureTool(tool);
    metrics.calls += 1;
    metrics.totalLatencyMs += latencyMs;
    if (outcome.isError) {
      metrics.errors += 1;
    } else {
      metrics.successes += 1;
    }

    switch (outcome.status) {
      case 'partial':
        metrics.partials += 1;
        break;
      case 'not_found':
        metrics.notFound += 1;
        break;
      case 'invalid':
        metrics.invalid += 1;
        break;
      default:
        break;
    }
  }

  snapshot() {
    const caches: CacheMetricsSnapshot[] = Array.from(this.cacheMetrics.entries()).map(([name, metrics]) => ({
      name,
      kind: metrics.kind,
      hits: metrics.hits,
      misses: metrics.misses,
      writes: metrics.writes,
      evictions: metrics.evictions,
      size: metrics.size,
      estimated_bytes: metrics.estimatedBytes,
      hit_rate: ratio(metrics.hits, metrics.hits + metrics.misses),
    }));

    const tools: ToolMetricsSnapshot[] = Array.from(this.toolMetrics.entries()).map(([tool, metrics]) => ({
      tool,
      calls: metrics.calls,
      successes: metrics.successes,
      errors: metrics.errors,
      partials: metrics.partials,
      not_found: metrics.notFound,
      invalid: metrics.invalid,
      avg_latency_ms: metrics.calls === 0 ? 0 : Math.round(metrics.totalLatencyMs / metrics.calls),
      error_rate: ratio(metrics.errors, metrics.calls),
    }));

    const upstreams: UpstreamMetricsSnapshot[] = Array.from(this.upstreamMetrics.entries()).map(([source, metrics]) => ({
      source,
      requests: metrics.requests,
      successes: metrics.successes,
      failures: metrics.failures,
      timeouts: metrics.timeouts,
      parse_errors: metrics.parseErrors,
      circuit_open_rejections: metrics.circuitOpenRejections,
      total_latency_ms: metrics.totalLatencyMs,
      avg_latency_ms: metrics.requests === 0 ? 0 : Math.round(metrics.totalLatencyMs / metrics.requests),
      failure_rate: ratio(metrics.failures, metrics.requests),
    }));

    const degradedReasons = evaluateDegradedReasons({
      upstreams,
      partialFailures: this.partialFailures,
      indexes: indexMetadataRegistry.list(),
    });
    const degradedSources = Array.from(new Set(degradedReasons.map((reason) => reason.source)));

    return {
      started_at: this.startedAt,
      degraded: degradedReasons.length > 0,
      degraded_sources: degradedSources,
      degraded_reasons: degradedReasons,
      caches,
      tools,
      upstreams,
      indexes: indexMetadataRegistry.list(),
      partial_failures: Object.fromEntries(this.partialFailures),
    };
  }

  reset(): void {
    this.cacheMetrics.clear();
    this.toolMetrics.clear();
    this.upstreamMetrics.clear();
    this.partialFailures.clear();
  }

  private ensureCache(name: string, kind: 'raw' | 'normalized'): CacheMetricsState {
    const existing = this.cacheMetrics.get(name);
    if (existing) {
      return existing;
    }
    const created: CacheMetricsState = {
      kind,
      hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0,
      size: 0,
      estimatedBytes: 0,
    };
    this.cacheMetrics.set(name, created);
    return created;
  }

  private ensureUpstream(source: string): UpstreamMetricsState {
    const existing = this.upstreamMetrics.get(source);
    if (existing) {
      return existing;
    }
    const created: UpstreamMetricsState = {
      requests: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      parseErrors: 0,
      circuitOpenRejections: 0,
      totalLatencyMs: 0,
    };
    this.upstreamMetrics.set(source, created);
    return created;
  }

  private ensureTool(tool: string): ToolMetricsState {
    const existing = this.toolMetrics.get(tool);
    if (existing) {
      return existing;
    }
    const created: ToolMetricsState = {
      calls: 0,
      successes: 0,
      errors: 0,
      partials: 0,
      notFound: 0,
      invalid: 0,
      totalLatencyMs: 0,
    };
    this.toolMetrics.set(tool, created);
    return created;
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

export const observabilityRegistry = new ObservabilityRegistry();

function evaluateDegradedReasons(input: {
  upstreams: UpstreamMetricsSnapshot[];
  partialFailures: Map<string, number>;
  indexes: IndexSnapshotMeta[];
}): DegradedReason[] {
  const reasons: DegradedReason[] = [];

  for (const upstream of input.upstreams) {
    if (upstream.timeouts > 0 && ratio(upstream.timeouts, upstream.requests) >= 0.2) {
      reasons.push({
        source: upstream.source,
        code: 'TIMEOUT_RATE_HIGH',
        message: `timeout rate=${ratio(upstream.timeouts, upstream.requests)}`,
      });
    }
    if (upstream.parse_errors > 0) {
      reasons.push({
        source: upstream.source,
        code: 'PARSE_ERROR_DETECTED',
        message: `parse_errors=${upstream.parse_errors}`,
      });
    }
    if (upstream.circuit_open_rejections > 0) {
      reasons.push({
        source: upstream.source,
        code: 'CIRCUIT_OPEN',
        message: `circuit_open_rejections=${upstream.circuit_open_rejections}`,
      });
    }
  }

  for (const [source, count] of input.partialFailures.entries()) {
    if (count > 0) {
      reasons.push({
        source,
        code: 'PARTIAL_FAILURE_DETECTED',
        message: `partial_failures=${count}`,
      });
    }
  }

  for (const index of input.indexes) {
    if (index.freshness === 'stale') {
      reasons.push({
        source: index.source,
        code: 'STALE_INDEX',
        message: `generated_at=${index.generated_at}`,
      });
    }
  }

  return reasons;
}
