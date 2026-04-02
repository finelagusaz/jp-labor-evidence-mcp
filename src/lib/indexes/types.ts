export type IndexSource = 'egov' | 'mhlw' | 'jaish';

export type IndexFreshness = 'fresh' | 'stale' | 'unknown';
export type CitationBasis = 'index' | 'upstream';

export interface Citation {
  label: string;
  locator?: string;
  source_type?: IndexSource;
  source_url?: string;
  indexed_at?: string;
  retrieved_at?: string;
  citation_basis?: CitationBasis;
}

export interface IndexSnapshotMeta {
  source: IndexSource;
  generated_at: string;
  last_success_at?: string;
  last_failure_at?: string;
  freshness: IndexFreshness;
  entry_count: number;
  coverage_ratio?: number;
  storage_path?: string;
  snapshot_id?: string;
  active_snapshot_id?: string;
  last_promotion_at?: string;
  last_known_good_at?: string;
  rollback_count?: number;
  covered_years?: number[];
  query_hit_rate?: number;
  last_sync_scope?: string;
  cold_start_minimum_scope?: string;
}

export interface LawIndexEntry {
  canonical_id: string;
  law_id: string;
  law_title: string;
  law_num?: string;
  law_type: string;
  aliases: string[];
  source_url: string;
  updated_at?: string;
  freshness: IndexFreshness;
  citations: Citation[];
}

export interface TsutatsuIndexEntry {
  canonical_id: string;
  source_type: 'mhlw' | 'jaish';
  title: string;
  source_url: string;
  number?: string;
  date?: string;
  aliases: string[];
  updated_at?: string;
  freshness: IndexFreshness;
  citations: Citation[];
}
