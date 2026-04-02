import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/egov-client.js', () => ({
  fetchLawData: vi.fn(),
  searchLaws: vi.fn(),
  getEgovUrl: (lawId: string) => `https://laws.e-gov.go.jp/law/${lawId}`,
}));

import { searchLaws } from '../src/lib/egov-client.js';
import { resolveLaw } from '../src/lib/services/law-service.js';

describe('resolveLaw service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registry にない正式名称を e-Gov の厳密一致で補完できる', async () => {
    vi.mocked(searchLaws).mockResolvedValue([
      {
        law_info: {
          law_id: '999AC0000000001',
          law_type: 'Act',
          law_num: '令和六年法律第一号',
          promulgation_date: '2024-01-01',
        },
        revision_info: {
          law_title: '架空労働支援法',
          abbrev: '架空法',
        },
      },
    ]);

    const result = await resolveLaw({ query: '架空労働支援法' });

    expect(result.resolution).toBe('resolved');
    expect(result.candidates[0]?.lawId).toBe('999AC0000000001');
    expect(result.warnings[0]?.code).toBe('UPSTREAM_EXACT_MATCH');
  });
});
