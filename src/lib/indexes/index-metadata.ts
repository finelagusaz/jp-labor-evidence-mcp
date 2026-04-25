import { getIndexFilePath, hasPersistedIndex } from './index-store.js';
import type { IndexFreshness, IndexSnapshotMeta, IndexSource } from './types.js';

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type MutableIndexSnapshotMeta = {
  source: IndexSource;
  generated_at: string;
  last_success_at?: string;
  last_failure_at?: string;
  freshness?: IndexFreshness;
  entry_count: number;
  coverage_ratio?: number;
  snapshot_id?: string;
  active_snapshot_id?: string;
  last_promotion_at?: string;
  last_known_good_at?: string;
  rollback_count?: number;
  covered_years?: number[];
  query_hit_rate?: number;
  last_sync_scope?: string;
  cold_start_minimum_scope?: string;
  query_requests?: number;
  query_hits?: number;
};

class IndexMetadataRegistry {
  private readonly snapshots = new Map<string, MutableIndexSnapshotMeta>();

  register(snapshot: MutableIndexSnapshotMeta): void {
    this.snapshots.set(snapshot.source, snapshot);
  }

  recordSuccess(
    source: IndexSource,
    generatedAt: string,
    entryCount: number,
    coverageRatio?: number,
    extra?: {
      coveredYears?: number[];
      lastSyncScope?: string;
      coldStartMinimumScope?: string;
    },
  ): void {
    const existing = this.snapshots.get(source);
    const queryRequests = existing?.query_requests ?? 0;
    const queryHits = existing?.query_hits ?? 0;
    this.snapshots.set(source, {
      source,
      generated_at: generatedAt,
      last_success_at: generatedAt,
      last_failure_at: existing?.last_failure_at,
      freshness: 'fresh',
      entry_count: entryCount,
      coverage_ratio: coverageRatio ?? existing?.coverage_ratio,
      snapshot_id: existing?.snapshot_id,
      active_snapshot_id: existing?.active_snapshot_id,
      last_promotion_at: existing?.last_promotion_at,
      last_known_good_at: existing?.last_known_good_at,
      rollback_count: existing?.rollback_count,
      covered_years: extra?.coveredYears ?? existing?.covered_years,
      query_hit_rate: queryRequests === 0 ? existing?.query_hit_rate : Number((queryHits / queryRequests).toFixed(4)),
      last_sync_scope: extra?.lastSyncScope ?? existing?.last_sync_scope,
      cold_start_minimum_scope: extra?.coldStartMinimumScope ?? existing?.cold_start_minimum_scope,
      query_requests: queryRequests,
      query_hits: queryHits,
    });
  }

  recordFailure(source: IndexSource, failedAt: string): void {
    const existing = this.snapshots.get(source);
    if (!existing) {
      this.snapshots.set(source, {
        source,
        generated_at: failedAt,
        last_failure_at: failedAt,
        freshness: 'unknown',
        entry_count: 0,
      });
      return;
    }
    existing.last_failure_at = failedAt;
  }

  list(): IndexSnapshotMeta[] {
    return Array.from(this.snapshots.values())
      .map((snapshot) => {
        const bundledAgeDays =
          snapshot.source === 'egov'
            ? (() => {
                const generatedMs = Date.parse(snapshot.generated_at);
                return Number.isNaN(generatedMs)
                  ? undefined
                  : Math.floor((Date.now() - generatedMs) / DAY_MS);
              })()
            : undefined;
        return {
          source: snapshot.source,
          generated_at: snapshot.generated_at,
          last_success_at: snapshot.last_success_at,
          last_failure_at: snapshot.last_failure_at,
          freshness: snapshot.freshness ?? inferFreshness(snapshot.generated_at),
          entry_count: snapshot.entry_count,
          coverage_ratio: snapshot.coverage_ratio,
          bundled_age_days: bundledAgeDays,
          storage_path: hasPersistedIndex(snapshot.source) ? getIndexFilePath(snapshot.source) : undefined,
          snapshot_id: snapshot.snapshot_id,
          active_snapshot_id: snapshot.active_snapshot_id,
          last_promotion_at: snapshot.last_promotion_at,
          last_known_good_at: snapshot.last_known_good_at,
          rollback_count: snapshot.rollback_count ?? 0,
          covered_years: snapshot.covered_years,
          query_hit_rate: snapshot.query_hit_rate,
          last_sync_scope: snapshot.last_sync_scope,
          cold_start_minimum_scope: snapshot.cold_start_minimum_scope,
        };
      })
      .sort((a, b) => a.source.localeCompare(b.source, 'ja-JP'));
  }

  recordRollback(source: IndexSource, rolledBackAt: string, activeSnapshotId?: string): void {
    const existing = this.snapshots.get(source);
    if (!existing) {
      this.snapshots.set(source, {
        source,
        generated_at: rolledBackAt,
        freshness: 'unknown',
        entry_count: 0,
        active_snapshot_id: activeSnapshotId,
        last_known_good_at: rolledBackAt,
        rollback_count: 1,
      });
      return;
    }
    existing.active_snapshot_id = activeSnapshotId ?? existing.active_snapshot_id;
    existing.last_known_good_at = rolledBackAt;
    existing.rollback_count = (existing.rollback_count ?? 0) + 1;
  }

  recordQuery(source: IndexSource, hit: boolean): void {
    const existing = this.snapshots.get(source);
    if (!existing) {
      this.snapshots.set(source, {
        source,
        generated_at: new Date(0).toISOString(),
        freshness: 'unknown',
        entry_count: 0,
        query_requests: 1,
        query_hits: hit ? 1 : 0,
        query_hit_rate: hit ? 1 : 0,
      });
      return;
    }

    existing.query_requests = (existing.query_requests ?? 0) + 1;
    existing.query_hits = (existing.query_hits ?? 0) + (hit ? 1 : 0);
    existing.query_hit_rate = Number(((existing.query_hits ?? 0) / (existing.query_requests ?? 1)).toFixed(4));
  }

  reset(): void {
    this.snapshots.clear();
  }
}

export function inferFreshness(generatedAt: string, now = Date.now()): IndexFreshness {
  const timestamp = Date.parse(generatedAt);
  if (Number.isNaN(timestamp)) {
    return 'unknown';
  }
  return now - timestamp > STALE_AFTER_MS ? 'stale' : 'fresh';
}

export const indexMetadataRegistry = new IndexMetadataRegistry();
