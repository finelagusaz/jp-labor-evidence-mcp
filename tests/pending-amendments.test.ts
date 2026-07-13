import { describe, expect, it } from 'vitest';
import { buildVersionPinnedUrl } from '../src/lib/evidence-metadata.js';

describe('buildVersionPinnedUrl', () => {
  it('law_revision_id から /api/2/law_data/{id} を導出', () => {
    expect(buildVersionPinnedUrl('322AC0000000049_20281223_508AC0000000046'))
      .toBe('https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049_20281223_508AC0000000046');
  });
  it('null/空/undefined は undefined', () => {
    expect(buildVersionPinnedUrl(undefined)).toBeUndefined();
    expect(buildVersionPinnedUrl('')).toBeUndefined();
    expect(buildVersionPinnedUrl('   ')).toBeUndefined();
  });
});
