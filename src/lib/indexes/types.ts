export type IndexFreshness = 'fresh' | 'stale' | 'unknown';

export interface Citation {
  label: string;
  locator?: string;
}

export interface IndexSnapshotMeta {
  source: 'egov' | 'mhlw' | 'jaish';
  generated_at: string;
  last_success_at?: string;
  last_failure_at?: string;
  freshness: IndexFreshness;
  entry_count: number;
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
