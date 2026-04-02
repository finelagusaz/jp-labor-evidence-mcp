import { beforeEach, describe, expect, it } from 'vitest';
import { indexMetadataRegistry, inferFreshness } from '../src/lib/indexes/index-metadata.js';

describe('index metadata registry', () => {
  beforeEach(() => {
    indexMetadataRegistry.reset();
  });

  it('freshness を日付から推定できる', () => {
    const fresh = inferFreshness('2026-04-01T00:00:00.000Z', Date.parse('2026-04-02T00:00:00.000Z'));
    const stale = inferFreshness('2026-03-01T00:00:00.000Z', Date.parse('2026-04-02T00:00:00.000Z'));

    expect(fresh).toBe('fresh');
    expect(stale).toBe('stale');
  });

  it('success / failure を registry に反映できる', () => {
    indexMetadataRegistry.recordSuccess('egov', '2026-04-02T00:00:00.000Z', 45);
    indexMetadataRegistry.recordFailure('egov', '2026-04-02T01:00:00.000Z');

    const snapshot = indexMetadataRegistry.list();

    expect(snapshot[0]?.source).toBe('egov');
    expect(snapshot[0]?.last_success_at).toBe('2026-04-02T00:00:00.000Z');
    expect(snapshot[0]?.last_failure_at).toBe('2026-04-02T01:00:00.000Z');
    expect(snapshot[0]?.entry_count).toBe(45);
  });
});
