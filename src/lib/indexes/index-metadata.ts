import type { IndexFreshness, IndexSnapshotMeta } from './types.js';

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type MutableIndexSnapshotMeta = {
  source: 'egov' | 'mhlw' | 'jaish';
  generated_at: string;
  last_success_at?: string;
  last_failure_at?: string;
  freshness?: IndexFreshness;
  entry_count: number;
};

class IndexMetadataRegistry {
  private readonly snapshots = new Map<string, MutableIndexSnapshotMeta>();

  register(snapshot: MutableIndexSnapshotMeta): void {
    this.snapshots.set(snapshot.source, snapshot);
  }

  recordSuccess(source: 'egov' | 'mhlw' | 'jaish', generatedAt: string, entryCount: number): void {
    const existing = this.snapshots.get(source);
    this.snapshots.set(source, {
      source,
      generated_at: generatedAt,
      last_success_at: generatedAt,
      last_failure_at: existing?.last_failure_at,
      freshness: 'fresh',
      entry_count: entryCount,
    });
  }

  recordFailure(source: 'egov' | 'mhlw' | 'jaish', failedAt: string): void {
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
      .map((snapshot) => ({
        source: snapshot.source,
        generated_at: snapshot.generated_at,
        last_success_at: snapshot.last_success_at,
        last_failure_at: snapshot.last_failure_at,
        freshness: snapshot.freshness ?? inferFreshness(snapshot.generated_at),
        entry_count: snapshot.entry_count,
      }))
      .sort((a, b) => a.source.localeCompare(b.source, 'ja-JP'));
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
