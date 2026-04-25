import { LAW_ALIAS_MAP, LAW_ID_MAP, type LawRegistryCandidate, isEgovLawId, resolveLawNameStrict, getKnownLawCandidateById } from '../law-registry.js';
import { buildLawIndexEntry } from './builders.js';
import { indexMetadataRegistry } from './index-metadata.js';
import { loadLastKnownGoodLawIndexSnapshot, loadLawIndexSnapshot, restoreCurrentFromLastKnownGood } from './index-store.js';
import { promoteLawIndexSnapshot } from './promotion.js';
import type { SerializedLawIndex } from './serialization.js';
import type { IndexSnapshotMeta, LawIndexEntry } from './types.js';

const GENERATED_AT = '2026-04-02T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function inferLawType(lawTitle: string): string {
  if (lawTitle.endsWith('施行令')) {
    return 'CabinetOrder';
  }
  if (lawTitle.endsWith('施行規則') || lawTitle.endsWith('規則')) {
    return 'MinisterialOrdinance';
  }
  return 'Act';
}

function buildAliasesByTitle(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [alias, title] of Object.entries(LAW_ALIAS_MAP)) {
    const aliases = map.get(title) ?? [];
    aliases.push(alias);
    map.set(title, aliases);
  }
  return map;
}

const ALIASES_BY_TITLE = buildAliasesByTitle();

const DEFAULT_LAW_INDEX_ENTRIES: LawIndexEntry[] = Object.entries(LAW_ID_MAP)
  .map(([lawTitle, lawId]) =>
    buildLawIndexEntry({
      lawId,
      lawTitle,
      lawType: inferLawType(lawTitle),
      aliases: ALIASES_BY_TITLE.get(lawTitle) ?? [],
      sourceUrl: `https://laws.e-gov.go.jp/law/${lawId}`,
      updatedAt: GENERATED_AT,
      freshness: 'fresh',
    })
  )
  .sort((a, b) => a.law_title.localeCompare(b.law_title, 'ja-JP'));

const DEFAULT_EGOV_INDEX_META: IndexSnapshotMeta = {
  source: 'egov',
  generated_at: GENERATED_AT,
  last_success_at: GENERATED_AT,
  freshness: 'unknown',
  entry_count: DEFAULT_LAW_INDEX_ENTRIES.length,
  coverage_ratio: 1,
  covered_years: [],
  query_hit_rate: 0,
  last_sync_scope: 'bundled_registry',
  cold_start_minimum_scope: 'bundled_registry',
};

function withBundledAge(meta: IndexSnapshotMeta): IndexSnapshotMeta {
  if (meta.source !== 'egov') return meta;
  const generatedMs = Date.parse(meta.generated_at);
  if (Number.isNaN(generatedMs)) return meta;
  return {
    ...meta,
    bundled_age_days: Math.floor((Date.now() - generatedMs) / DAY_MS),
  };
}

let lawIndexEntries: LawIndexEntry[] = DEFAULT_LAW_INDEX_ENTRIES;
let egovIndexMeta: IndexSnapshotMeta = DEFAULT_EGOV_INDEX_META;

indexMetadataRegistry.register(egovIndexMeta);

export function getEgovIndexMeta(): IndexSnapshotMeta {
  return withBundledAge(egovIndexMeta);
}

export function getBundledEgovIndexMeta(): IndexSnapshotMeta {
  return withBundledAge(DEFAULT_EGOV_INDEX_META);
}

export function getEgovIndexEntries(): LawIndexEntry[] {
  return lawIndexEntries;
}

export function getEgovIndexSnapshot(): SerializedLawIndex {
  return {
    meta: withBundledAge(egovIndexMeta),
    entries: lawIndexEntries,
  };
}

export function initializeEgovIndex(): void {
  try {
    const persisted = loadLawIndexSnapshot('egov');
    if (persisted) {
      lawIndexEntries = persisted.entries;
      egovIndexMeta = persisted.meta;
      indexMetadataRegistry.register(egovIndexMeta);
      return;
    }
  } catch (error) {
    indexMetadataRegistry.recordFailure('egov', new Date().toISOString());
    const lastKnownGood = loadLastKnownGoodLawIndexSnapshot('egov');
    if (lastKnownGood) {
      restoreCurrentFromLastKnownGood('egov');
      lawIndexEntries = lastKnownGood.entries;
      egovIndexMeta = lastKnownGood.meta;
      indexMetadataRegistry.register(egovIndexMeta);
      indexMetadataRegistry.recordRollback('egov', new Date().toISOString(), egovIndexMeta.snapshot_id);
      return;
    }
    if (error instanceof Error) {
      void error;
    }
  }

  persistEgovIndex();
}

export function persistEgovIndex(): void {
  const promoted = promoteLawIndexSnapshot('egov', {
    meta: {
      ...egovIndexMeta,
      entry_count: lawIndexEntries.length,
      freshness: 'unknown',
    },
    entries: lawIndexEntries,
  });
  egovIndexMeta = {
    ...egovIndexMeta,
    ...promoted.meta,
  };
  indexMetadataRegistry.register(egovIndexMeta);
}

export function resolveLawFromEgovIndex(query: string): {
  resolution: 'resolved' | 'ambiguous' | 'not_found';
  candidates: LawRegistryCandidate[];
  meta: IndexSnapshotMeta;
} {
  const trimmed = query.trim();
  if (!trimmed) {
      return { resolution: 'not_found', candidates: [], meta: withBundledAge(egovIndexMeta) };
  }

  if (isEgovLawId(trimmed)) {
    const known = getKnownLawCandidateById(trimmed);
    if (known) {
      return { resolution: 'resolved', candidates: [known], meta: withBundledAge(egovIndexMeta) };
    }
    return {
      resolution: 'resolved',
      candidates: [{
        lawId: trimmed,
        lawTitle: trimmed,
        lawType: 'Unknown',
        sourceUrl: `https://laws.e-gov.go.jp/law/${trimmed}`,
        aliases: [],
      }],
      meta: withBundledAge(egovIndexMeta),
    };
  }

  const strict = resolveLawNameStrict(trimmed);
  if (strict.lawId) {
    return {
      resolution: 'resolved',
      candidates: [toCandidate(findEntryByLawId(strict.lawId)!)],
      meta: withBundledAge(egovIndexMeta),
    };
  }

  const matches = searchEgovIndex(trimmed, undefined, 20).map(toCandidate);
  const resolution =
    matches.length === 0 ? 'not_found' :
    matches.length === 1 ? 'resolved' :
    'ambiguous';

  return {
    resolution,
    candidates: matches,
    meta: withBundledAge(egovIndexMeta),
  };
}

export function searchEgovIndex(keyword: string, lawType?: string, limit = 10): LawIndexEntry[] {
  const lowered = keyword.trim().toLocaleLowerCase('ja-JP');
  if (!lowered) {
    return [];
  }

  return lawIndexEntries
    .filter((entry) => {
      if (lawType && entry.law_type !== lawType) {
        return false;
      }
      const haystacks = [entry.law_title, ...entry.aliases];
      return haystacks.some((value) => value.toLocaleLowerCase('ja-JP').includes(lowered));
    })
    .slice(0, limit);
}

function findEntryByLawId(lawId: string): LawIndexEntry | undefined {
  return lawIndexEntries.find((entry) => entry.law_id === lawId);
}

function toCandidate(entry: LawIndexEntry): LawRegistryCandidate {
  return {
    lawId: entry.law_id,
    lawTitle: entry.law_title,
    lawType: entry.law_type,
    sourceUrl: entry.source_url,
    aliases: entry.aliases,
  };
}
