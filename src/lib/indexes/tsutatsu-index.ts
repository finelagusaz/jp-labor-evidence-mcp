import { buildJaishIndexEntry, buildMhlwIndexEntry } from './builders.js';
import { indexMetadataRegistry } from './index-metadata.js';
import { loadLastKnownGoodTsutatsuIndexSnapshot, loadTsutatsuIndexSnapshot, restoreCurrentFromLastKnownGood } from './index-store.js';
import { promoteTsutatsuIndexSnapshot } from './promotion.js';
import type { SerializedTsutatsuIndex } from './serialization.js';
import type { IndexSnapshotMeta, TsutatsuIndexEntry } from './types.js';
import type { JaishIndexEntry, MhlwSearchResult } from '../types.js';

class TsutatsuIndexRegistry {
  private readonly entries = new Map<'mhlw' | 'jaish', Map<string, TsutatsuIndexEntry>>([
    ['mhlw', new Map()],
    ['jaish', new Map()],
  ]);

  recordMhlwResults(results: MhlwSearchResult[], generatedAt = new Date().toISOString()): void {
    const store = this.entries.get('mhlw')!;
    for (const result of results) {
      const entry = buildMhlwIndexEntry(result, 'fresh');
      store.set(entry.canonical_id, entry);
    }
    indexMetadataRegistry.recordSuccess('mhlw', generatedAt, store.size, undefined, {
      coveredYears: collectCoveredYears(results.map((result) => result.date)),
      lastSyncScope: 'runtime_search_results',
      coldStartMinimumScope: 'manual_sync_or_runtime_learning',
    });
    this.persist('mhlw');
  }

  recordJaishResults(results: JaishIndexEntry[], generatedAt = new Date().toISOString()): void {
    const store = this.entries.get('jaish')!;
    for (const result of results) {
      const entry = buildJaishIndexEntry(result, 'fresh');
      store.set(entry.canonical_id, entry);
    }
    indexMetadataRegistry.recordSuccess('jaish', generatedAt, store.size, undefined, {
      coveredYears: collectCoveredYears(results.map((result) => result.date)),
      lastSyncScope: 'runtime_search_results',
      coldStartMinimumScope: 'manual_sync_or_runtime_learning',
    });
    this.persist('jaish');
  }

  recordFailure(source: 'mhlw' | 'jaish', failedAt = new Date().toISOString()): void {
    indexMetadataRegistry.recordFailure(source, failedAt);
    this.persist(source);
  }

  search(source: 'mhlw' | 'jaish', keyword: string, limit: number): {
    results: TsutatsuIndexEntry[];
    meta?: IndexSnapshotMeta;
  } {
    const lowered = keyword.trim().toLocaleLowerCase('ja-JP');
    if (!lowered) {
      return { results: [], meta: this.getMeta(source) };
    }

    const results = Array.from(this.entries.get(source)!.values())
      .filter((entry) => {
        const haystacks = [entry.title, entry.number ?? '', entry.date ?? '', ...entry.aliases];
        return haystacks.some((value) => value.toLocaleLowerCase('ja-JP').includes(lowered));
      })
      .slice(0, limit);

    return {
      results,
      meta: this.getMeta(source),
    };
  }

  getMeta(source: 'mhlw' | 'jaish'): IndexSnapshotMeta | undefined {
    return indexMetadataRegistry.list().find((entry) => entry.source === source);
  }

  getSnapshot(source: 'mhlw' | 'jaish'): SerializedTsutatsuIndex {
    return {
      meta: this.getMeta(source) ?? {
        source,
        generated_at: new Date(0).toISOString(),
        freshness: 'unknown',
        entry_count: this.entries.get(source)!.size,
      },
      entries: Array.from(this.entries.get(source)!.values()),
    };
  }

  loadFromDisk(source: 'mhlw' | 'jaish'): void {
    try {
      const snapshot = loadTsutatsuIndexSnapshot(source);
      if (!snapshot) {
        return;
      }
      const store = this.entries.get(source)!;
      store.clear();
      for (const entry of snapshot.entries) {
        store.set(entry.canonical_id, entry);
      }
      indexMetadataRegistry.register(snapshot.meta);
    } catch (error) {
      indexMetadataRegistry.recordFailure(source, new Date().toISOString());
      const snapshot = loadLastKnownGoodTsutatsuIndexSnapshot(source);
      if (!snapshot) {
        if (error instanceof Error) {
          void error;
        }
        return;
      }
      restoreCurrentFromLastKnownGood(source);
      const store = this.entries.get(source)!;
      store.clear();
      for (const entry of snapshot.entries) {
        store.set(entry.canonical_id, entry);
      }
      indexMetadataRegistry.register(snapshot.meta);
      indexMetadataRegistry.recordRollback(source, new Date().toISOString(), snapshot.meta.snapshot_id);
    }
  }

  persist(source: 'mhlw' | 'jaish'): void {
    const promoted = promoteTsutatsuIndexSnapshot(source, this.getSnapshot(source));
    indexMetadataRegistry.register(promoted.meta);
  }

  reset(): void {
    this.entries.get('mhlw')!.clear();
    this.entries.get('jaish')!.clear();
  }
}

export const tsutatsuIndexRegistry = new TsutatsuIndexRegistry();

function collectCoveredYears(values: Array<string | undefined>): number[] {
  return Array.from(new Set(
    values
      .map((value) => {
        if (!value) {
          return undefined;
        }
        const match = value.match(/(19|20)\d{2}/);
        return match ? Number(match[0]) : undefined;
      })
      .filter((value): value is number => value !== undefined)
  )).sort((a, b) => a - b);
}
