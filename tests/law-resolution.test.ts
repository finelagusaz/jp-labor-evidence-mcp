import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLawData } from '../src/lib/egov-client.js';
import { resolveLawCandidates, resolveLawNameStrict } from '../src/lib/law-registry.js';
import { ValidationError } from '../src/lib/errors.js';

describe('law resolution', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('略称を strict resolve できる', () => {
    expect(resolveLawNameStrict('労基法')).toEqual({
      name: '労働基準法',
      lawId: '322AC0000000049',
    });
  });

  it('部分一致では候補を複数返せる', () => {
    const candidates = resolveLawCandidates('労働');
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.some((candidate) => candidate.lawTitle === '労働基準法')).toBe(true);
  });

  it('未知の法令名は fetch 前に ValidationError で失敗する', async () => {
    await expect(fetchLawData('労働')).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('空の法令名は fetch 前に ValidationError で失敗する', async () => {
    await expect(fetchLawData('   ')).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
