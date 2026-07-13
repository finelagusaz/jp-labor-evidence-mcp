import { describe, expect, it } from 'vitest';
import { buildRevisionMetadata } from '../src/lib/evidence-metadata.js';
import type { EgovRevisionInfo } from '../src/lib/types.js';

describe('buildRevisionMetadata', () => {
  it('revision_info から機械可読メタへ写像し version_pinned_url を導出', () => {
    const revisionInfo: EgovRevisionInfo = {
      law_revision_id: '322AC0000000049_20260624_508AC0000000046',
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: null,
      amendment_law_num: '令和八年法律第四十六号',
      amendment_law_title: '民法等の一部を改正する法律の施行に伴う関係法律の整備等に関する法律',
      amendment_law_id: '508AC0000000046',
      current_revision_status: 'CurrentEnforced',
      repeal_status: 'None',
      repeal_date: null,
    };
    const meta = buildRevisionMetadata(revisionInfo);
    expect(meta?.current_enforcement_date).toBe('2026-06-24');
    expect(meta?.amendment_law_num).toBe('令和八年法律第四十六号');
    expect(meta?.current_revision_status).toBe('CurrentEnforced');
    expect(meta?.version_pinned_url).toBe(
      'https://laws.e-gov.go.jp/api/2/law_data/322AC0000000049_20260624_508AC0000000046',
    );
  });

  it('null / 空文字を undefined に正規化する（enforcement_note は含めない）', () => {
    const meta = buildRevisionMetadata({
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: null,
      repeal_date: '',
    });
    expect(meta?.current_enforcement_date).toBe('2026-06-24');
    expect(meta?.enforcement_note).toBeUndefined();
    expect(meta?.version_pinned_url).toBeUndefined();
  });

  it('revisionInfo が undefined または全欠落なら undefined', () => {
    expect(buildRevisionMetadata(undefined)).toBeUndefined();
    expect(buildRevisionMetadata({})).toBeUndefined();
    expect(buildRevisionMetadata({ amendment_law_num: null })).toBeUndefined();
  });
});
