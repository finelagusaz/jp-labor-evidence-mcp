import { describe, expect, it } from 'vitest';
import { CircuitOpenError, ParseError, UpstreamHttpError, UpstreamNotFoundError, UpstreamTimeoutError, failureReasonOf } from '../src/lib/errors.js';
import { mapErrorToEnvelope } from '../src/lib/tool-contract.js';

describe('tool-contract', () => {
  it('ParseError を parse_error として変換する', () => {
    const result = mapErrorToEnvelope(new ParseError('broken html'));

    expect(result.status).toBe('unavailable');
    expect(result.error_code).toBe('parse_error');
    expect(result.retryable).toBe(false);
    expect(result.degraded).toBe(true);
  });
});

describe('mapErrorToEnvelope: 上流の失敗の型', () => {
  it('404 は not_found', () => {
    expect(mapErrorToEnvelope(new UpstreamNotFoundError('https://laws.e-gov.go.jp/api/2/law_data/x'))).toMatchObject({
      status: 'not_found', error_code: 'not_found', retryable: false,
    });
  });

  it.each([
    [503, true],
    [429, true],
    [400, false],
  ])('HTTP %d は upstream_unavailable、retryable=%s', (status, retryable) => {
    expect(mapErrorToEnvelope(new UpstreamHttpError(status, '', 'https://example.com/x'))).toMatchObject({
      status: 'unavailable', error_code: 'upstream_unavailable', retryable,
    });
  });

  it('タイムアウト・サーキット開放は再試行可', () => {
    expect(mapErrorToEnvelope(new UpstreamTimeoutError('https://example.com/x', 1000)).retryable).toBe(true);
    expect(mapErrorToEnvelope(new CircuitOpenError('https://example.com', '2026-10-08T00:00:00.000Z')).retryable).toBe(true);
  });
});

describe('failureReasonOf', () => {
  it.each([
    [new UpstreamNotFoundError('u'), 'not_found'],
    [new CircuitOpenError('u', 't'), 'circuit_open'],
    [new UpstreamTimeoutError('u', 1), 'timeout'],
    [new UpstreamHttpError(503, '', 'u'), 'upstream_unavailable'],
    [new ParseError('x'), 'parse_error'],
    [new Error('x'), 'Error'],
  ])('%s → %s', (error, reason) => {
    expect(failureReasonOf(error)).toBe(reason);
  });
});
