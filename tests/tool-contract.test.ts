import { describe, expect, it } from 'vitest';
import { ParseError } from '../src/lib/errors.js';
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
