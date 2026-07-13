import { describe, expect, it } from 'vitest';
import {
  normalizeLawTitle,
  classifyFetchError,
  classifyResult,
  summarizeReport,
  isBumpGateSatisfied,
  type LawVerificationResult,
} from '../src/lib/indexes/registry-verification.js';

describe('normalizeLawTitle', () => {
  it('NFKC 正規化と空白除去で表層差を吸収する', () => {
    // 全角スペース・半角スペース・前後空白は無視、幅は NFKC で統一
    expect(normalizeLawTitle(' 労働 基準法 ')).toBe(normalizeLawTitle('労働基準法'));
    expect(normalizeLawTitle('労働基準法')).toBe('労働基準法');
  });
});

describe('classifyFetchError', () => {
  it('404 は NOT_FOUND、それ以外は ERROR', () => {
    expect(classifyFetchError('HTTP 404 Not Found — https://laws.e-gov.go.jp/api/2/law_data/x')).toBe('NOT_FOUND');
    expect(classifyFetchError('HTTP 503 Service Unavailable — url')).toBe('ERROR');
    expect(classifyFetchError('Circuit breaker is open for https://... until 2026-...')).toBe('ERROR');
  });
});

describe('classifyResult', () => {
  it('名称一致で OK、ズレで NAME_MISMATCH', () => {
    expect(classifyResult('労働基準法', { ok: true, title: '労働基準法' })).toBe('OK');
    expect(classifyResult('労働基準法', { ok: true, title: '労働基準法施行令' })).toBe('NAME_MISMATCH');
  });
  it('取得失敗はエラー種別へ写像する', () => {
    expect(classifyResult('X', { ok: false, errorMessage: 'HTTP 404 ...' })).toBe('NOT_FOUND');
    expect(classifyResult('X', { ok: false, errorMessage: 'HTTP 500 ...' })).toBe('ERROR');
  });
});

describe('summarizeReport', () => {
  const ok = (lawId: string): LawVerificationResult => ({ lawId, expectedName: 'n', status: 'OK' });
  it('全件 OK なら allOk=true', () => {
    const report = summarizeReport([ok('a'), ok('b')], '2026-07-13T01:00:00.000Z');
    expect(report.counts.OK).toBe(2);
    expect(report.total).toBe(2);
    expect(report.allOk).toBe(true);
  });
  it('1件でも非 OK なら allOk=false', () => {
    const report = summarizeReport(
      [ok('a'), { lawId: 'b', expectedName: 'n', status: 'NOT_FOUND' }],
      '2026-07-13T01:00:00.000Z'
    );
    expect(report.counts.NOT_FOUND).toBe(1);
    expect(report.allOk).toBe(false);
  });
  it('空配列は allOk=false', () => {
    expect(summarizeReport([], '2026-07-13T01:00:00.000Z').allOk).toBe(false);
  });
});

describe('isBumpGateSatisfied', () => {
  const report = summarizeReport(
    [{ lawId: 'a', expectedName: 'n', status: 'OK' }],
    '2026-07-13T09:00:00.000Z'
  );
  it('全件 OK かつ検証日(UTC)が bump 日と一致で true', () => {
    expect(isBumpGateSatisfied(report, '2026-07-13')).toBe(true);
  });
  it('検証日がズレると false（古いレポート流用の防止）', () => {
    expect(isBumpGateSatisfied(report, '2026-07-14')).toBe(false);
  });
  it('非 OK を含むと false', () => {
    const bad = summarizeReport(
      [{ lawId: 'a', expectedName: 'n', status: 'ERROR' }],
      '2026-07-13T09:00:00.000Z'
    );
    expect(isBumpGateSatisfied(bad, '2026-07-13')).toBe(false);
  });
});
