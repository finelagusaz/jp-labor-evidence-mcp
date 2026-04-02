import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { observabilityRegistry } from './observability.js';

const REPORT_INTERVAL_MS = 60_000;

export function startObservabilityReporter(server: McpServer): void {
  let lastDegradedState: boolean | null = null;
  let lastSummaryAt = 0;

  const timer = setInterval(() => {
    void report();
  }, REPORT_INTERVAL_MS);
  timer.unref();

  async function report(): Promise<void> {
    const snapshot = observabilityRegistry.snapshot();
    const now = Date.now();

    if (lastDegradedState !== snapshot.degraded) {
      lastDegradedState = snapshot.degraded;
      await safeLog(server, snapshot.degraded ? 'warning' : 'notice', {
        event: 'degraded_state_changed',
        degraded: snapshot.degraded,
        degraded_sources: snapshot.degraded_sources,
        degraded_reasons: snapshot.degraded_reasons,
      });
      lastSummaryAt = now;
      return;
    }

    if (now - lastSummaryAt >= REPORT_INTERVAL_MS * 5) {
      lastSummaryAt = now;
      await safeLog(server, 'info', {
        event: 'observability_summary',
        degraded: snapshot.degraded,
        caches: snapshot.caches.map((cache) => ({
          name: cache.name,
          hit_rate: cache.hit_rate,
          size: cache.size,
        })),
        upstreams: snapshot.upstreams.map((upstream) => ({
          source: upstream.source,
          requests: upstream.requests,
          failure_rate: upstream.failure_rate,
          parse_errors: upstream.parse_errors,
          timeouts: upstream.timeouts,
        })),
      });
    }
  }
}

async function safeLog(
  server: McpServer,
  level: 'info' | 'notice' | 'warning',
  data: unknown,
): Promise<void> {
  try {
    await server.sendLoggingMessage({
      level,
      logger: 'labor-law-mcp/observability',
      data,
    });
  } catch {
    // クライアント未接続や logging 未設定時は黙って捨てる
  }
}
