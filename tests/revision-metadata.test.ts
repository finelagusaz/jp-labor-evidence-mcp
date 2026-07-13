import { describe, expect, it } from 'vitest';
import { buildRevisionMetadata, buildVersionInfoString } from '../src/lib/evidence-metadata.js';
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

describe('buildVersionInfoString', () => {
  it('base（法令番号 / 公布日）に施行日セグメント＋hedge を append する', () => {
    const s = buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
      amendment_law_title: '民法等の一部を改正する法律…整備法',
    });
    expect(s).toContain('昭和二十二年法律第四十九号');
    expect(s).toContain('1947-04-07');
    expect(s).toContain('現行版の施行日 2026-06-24');
    expect(s).toContain('引用した条文が改正されたとは限りません');
  });

  it('改正法名は文字列に載せない（誤帰属回避）', () => {
    const s = buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
      amendment_law_title: '民法等の一部を改正する法律…整備法',
      amendment_law_num: '令和八年法律第四十六号',
    });
    expect(s).not.toContain('整備法');
    expect(s).not.toContain('令和八年法律第四十六号');
  });

  it('revision または施行日が無ければ base のみへ degrade（JST を付けない）', () => {
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', undefined))
      .toBe('昭和二十二年法律第四十九号 / 1947-04-07');
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', { repeal_status: 'None' }))
      .toBe('昭和二十二年法律第四十九号 / 1947-04-07');
    expect(buildVersionInfoString('昭和二十二年法律第四十九号', '1947-04-07', {
      amendment_enforcement_date: '2026-06-24',
    })).not.toContain('JST');
  });

  it('施行期日規定（enforcement_note）があれば併記し裸の断定を避ける', () => {
    const s = buildVersionInfoString('某法律', '2000-01-01', {
      amendment_enforcement_date: '2026-06-24',
      amendment_enforcement_comment: '公布の日から起算して一年を超えない範囲内において政令で定める日',
    });
    expect(s).toContain('施行期日規定: 公布の日から起算して');
  });
});
