import { describe, expect, it } from 'vitest';
import { DAY_MS, computeBundledAgeDays } from '../src/lib/indexes/time.js';

describe('indexes/time', () => {
  it('DAY_MS は 24 時間のミリ秒', () => {
    expect(DAY_MS).toBe(86_400_000);
  });

  describe('computeBundledAgeDays', () => {
    const base = Date.parse('2026-06-10T00:00:00.000Z');

    it('生成時刻からの経過日数を floor で返す', () => {
      expect(computeBundledAgeDays('2026-06-10T00:00:00.000Z', base + 5 * DAY_MS)).toBe(5);
    });

    it('端数日は切り捨てる', () => {
      expect(computeBundledAgeDays('2026-06-10T00:00:00.000Z', base + 5 * DAY_MS + DAY_MS / 2)).toBe(5);
    });

    it('同時刻なら 0', () => {
      expect(computeBundledAgeDays('2026-06-10T00:00:00.000Z', base)).toBe(0);
    });

    it('パース不能な生成時刻は undefined', () => {
      expect(computeBundledAgeDays('not-a-date', base)).toBeUndefined();
    });
  });
});
