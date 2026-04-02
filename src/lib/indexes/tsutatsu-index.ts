import { buildJaishIndexEntry, buildMhlwIndexEntry } from './builders.js';
import { indexMetadataRegistry } from './index-metadata.js';
import { loadTsutatsuIndexSnapshot, saveTsutatsuIndexSnapshot } from './index-store.js';
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
    indexMetadataRegistry.recordSuccess('mhlw', generatedAt, store.size);
    this.persist('mhlw');
  }

  recordJaishResults(results: JaishIndexEntry[], generatedAt = new Date().toISOString()): void {
    const store = this.entries.get('jaish')!;
    for (const result of results) {
      const entry = buildJaishIndexEntry(result, 'fresh');
      store.set(entry.canonical_id, entry);
    }
    indexMetadataRegistry.recordSuccess('jaish', generatedAt, store.size);
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
  }

  persist(source: 'mhlw' | 'jaish'): void {
    saveTsutatsuIndexSnapshot(source, this.getSnapshot(source));
  }

  reset(): void {
    this.entries.get('mhlw')!.clear();
    this.entries.get('jaish')!.clear();
  }
}

export const tsutatsuIndexRegistry = new TsutatsuIndexRegistry();
