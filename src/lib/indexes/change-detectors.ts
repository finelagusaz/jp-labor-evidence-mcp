import { getBundledEgovIndexMeta } from './egov-index.js';
import { loadLawIndexSnapshot, loadTsutatsuIndexSnapshot } from './index-store.js';
import type { IndexSource } from './types.js';

export interface ChangeDetectionSummary {
  source: IndexSource;
  added: number;
  updated: number;
  removed: number;
  unknown: number;
  should_full_rebuild: boolean;
  reason?: string;
}

export interface IncrementalSyncPlan {
  summaries: ChangeDetectionSummary[];
  should_full_rebuild: boolean;
  reason?: string;
}

export function createIncrementalSyncPlan(): IncrementalSyncPlan {
  const summaries = [
    detectEgovChanges(),
    detectTsutatsuChanges('mhlw'),
    detectTsutatsuChanges('jaish'),
  ];

  const blocking = summaries.find((summary) => summary.should_full_rebuild);
  return {
    summaries,
    should_full_rebuild: Boolean(blocking),
    reason: blocking?.reason,
  };
}

export function detectEgovChanges(): ChangeDetectionSummary {
  const current = loadLawIndexSnapshot('egov');
  const bundled = getBundledEgovIndexMeta();

  if (!current) {
    return {
      source: 'egov',
      added: 0,
      updated: 0,
      removed: 0,
      unknown: 1,
      should_full_rebuild: true,
      reason: 'NO_BASELINE',
    };
  }

  if (Date.parse(current.meta.generated_at) < Date.parse(bundled.generated_at)) {
    return {
      source: 'egov',
      added: 0,
      updated: bundled.entry_count,
      removed: 0,
      unknown: 0,
      should_full_rebuild: false,
      reason: 'BUNDLED_INDEX_NEWER',
    };
  }

  return {
    source: 'egov',
    added: 0,
    updated: 0,
    removed: 0,
    unknown: 0,
    should_full_rebuild: false,
  };
}

export function detectTsutatsuChanges(source: 'mhlw' | 'jaish'): ChangeDetectionSummary {
  const current = loadTsutatsuIndexSnapshot(source);

  if (!current) {
    return {
      source,
      added: 0,
      updated: 0,
      removed: 0,
      unknown: 1,
      should_full_rebuild: true,
      reason: 'NO_BASELINE',
    };
  }

  if (typeof current.meta.coverage_ratio === 'number' && current.meta.coverage_ratio < 0.6) {
    return {
      source,
      added: 0,
      updated: 0,
      removed: 0,
      unknown: current.entries.length || 1,
      should_full_rebuild: true,
      reason: 'COVERAGE_BELOW_THRESHOLD',
    };
  }

  if (current.meta.freshness === 'stale') {
    return {
      source,
      added: 0,
      updated: 0,
      removed: 0,
      unknown: current.entries.length || 1,
      should_full_rebuild: true,
      reason: 'STALE_INDEX',
    };
  }

  return {
    source,
    added: 0,
    updated: 0,
    removed: 0,
    unknown: 0,
    should_full_rebuild: false,
  };
}
