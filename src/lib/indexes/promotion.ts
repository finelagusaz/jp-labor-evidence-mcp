import { loadLawIndexSnapshot, loadStagedLawIndexSnapshot, loadStagedTsutatsuIndexSnapshot, loadTsutatsuIndexSnapshot, promoteStagedIndex, removeStagedIndex, saveStagedLawIndexSnapshot, saveStagedTsutatsuIndexSnapshot } from './index-store.js';
import type { SerializedLawIndex, SerializedTsutatsuIndex } from './serialization.js';
import type { IndexSource, LawIndexEntry, TsutatsuIndexEntry } from './types.js';

const MIN_ENTRY_COUNT_RATIO = 0.5;
const MIN_COVERAGE_DROP = 0.25;

export class IndexPromotionError extends Error {
  constructor(message: string, readonly reasons: string[]) {
    super(message);
    this.name = 'IndexPromotionError';
  }
}

export interface PromotionValidationResult {
  ok: boolean;
  reasons: string[];
}

export function stageLawIndexSnapshot(source: 'egov', snapshot: SerializedLawIndex): SerializedLawIndex {
  const staged = prepareSnapshot(source, snapshot.entries, snapshot.meta);
  saveStagedLawIndexSnapshot(source, staged);
  return staged;
}

export function stageTsutatsuIndexSnapshot(
  source: 'mhlw' | 'jaish',
  snapshot: SerializedTsutatsuIndex,
): SerializedTsutatsuIndex {
  const staged = prepareSnapshot(source, snapshot.entries, snapshot.meta);
  saveStagedTsutatsuIndexSnapshot(source, staged);
  return staged;
}

export function promoteLawIndexSnapshot(source: 'egov', snapshot: SerializedLawIndex): SerializedLawIndex {
  stageLawIndexSnapshot(source, snapshot);
  return promoteStagedLawIndexSnapshot(source);
}

export function promoteTsutatsuIndexSnapshot(
  source: 'mhlw' | 'jaish',
  snapshot: SerializedTsutatsuIndex,
): SerializedTsutatsuIndex {
  stageTsutatsuIndexSnapshot(source, snapshot);
  return promoteStagedTsutatsuIndexSnapshot(source);
}

export function promoteStagedLawIndexSnapshot(source: 'egov'): SerializedLawIndex {
  const staged = loadStagedLawIndexSnapshot(source);
  if (!staged) {
    throw new IndexPromotionError(`No staged snapshot for ${source}`, ['STAGED_SNAPSHOT_NOT_FOUND']);
  }
  const current = loadLawIndexSnapshot(source);
  const validation = validatePromotionCandidate(staged, current);
  if (!validation.ok) {
    removeStagedIndex(source);
    throw new IndexPromotionError(`Failed to promote ${source} index snapshot`, validation.reasons);
  }
  const promoted = finalizeSnapshot(staged);
  saveStagedLawIndexSnapshot(source, promoted);
  promoteStagedIndex(source);
  return promoted;
}

export function promoteStagedTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish'): SerializedTsutatsuIndex {
  const staged = loadStagedTsutatsuIndexSnapshot(source);
  if (!staged) {
    throw new IndexPromotionError(`No staged snapshot for ${source}`, ['STAGED_SNAPSHOT_NOT_FOUND']);
  }
  const current = loadTsutatsuIndexSnapshot(source);
  const validation = validatePromotionCandidate(staged, current);
  if (!validation.ok) {
    removeStagedIndex(source);
    throw new IndexPromotionError(`Failed to promote ${source} index snapshot`, validation.reasons);
  }
  const promoted = finalizeSnapshot(staged);
  saveStagedTsutatsuIndexSnapshot(source, promoted);
  promoteStagedIndex(source);
  return promoted;
}

export function validatePromotionCandidate(
  candidate: SerializedLawIndex | SerializedTsutatsuIndex,
  current?: SerializedLawIndex | SerializedTsutatsuIndex | null,
): PromotionValidationResult {
  const reasons: string[] = [];

  if (candidate.meta.entry_count !== candidate.entries.length) {
    reasons.push('ENTRY_COUNT_MISMATCH');
  }

  if (Number.isNaN(Date.parse(candidate.meta.generated_at))) {
    reasons.push('INVALID_GENERATED_AT');
  }

  if (current && current.meta.entry_count >= 10) {
    const nextRatio = candidate.meta.entry_count / current.meta.entry_count;
    if (nextRatio < MIN_ENTRY_COUNT_RATIO) {
      reasons.push('ENTRY_COUNT_DROP_TOO_LARGE');
    }
  }

  if (
    current &&
    typeof current.meta.coverage_ratio === 'number' &&
    typeof candidate.meta.coverage_ratio === 'number' &&
    current.meta.coverage_ratio - candidate.meta.coverage_ratio > MIN_COVERAGE_DROP
  ) {
    reasons.push('COVERAGE_DROP_TOO_LARGE');
  }

  return { ok: reasons.length === 0, reasons };
}

function prepareSnapshot<TEntry extends LawIndexEntry | TsutatsuIndexEntry>(
  source: IndexSource,
  entries: TEntry[],
  meta: { generated_at: string; last_success_at?: string; last_failure_at?: string; freshness: 'fresh' | 'stale' | 'unknown'; coverage_ratio?: number; snapshot_id?: string; last_promotion_at?: string },
): { meta: typeof meta & { source: IndexSource; entry_count: number; snapshot_id: string }; entries: TEntry[] } {
  return {
    meta: {
      ...meta,
      source,
      entry_count: entries.length,
      snapshot_id: meta.snapshot_id ?? `${source}-${Date.now()}`,
    },
    entries,
  };
}

function finalizeSnapshot<TSnapshot extends SerializedLawIndex | SerializedTsutatsuIndex>(snapshot: TSnapshot): TSnapshot {
  const promotedAt = new Date().toISOString();
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      active_snapshot_id: snapshot.meta.snapshot_id,
      last_promotion_at: promotedAt,
      last_known_good_at: promotedAt,
    },
  };
}
