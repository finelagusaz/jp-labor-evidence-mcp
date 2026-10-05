/** One day in milliseconds. Single source of truth for index time math. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** JST (UTC+9) offset in milliseconds. */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * UTC ms timestamp → Asia/Tokyo の暦日 `YYYY-MM-DD`。
 * e-Gov の施行日（JST の暦日）との比較や表示に使う。
 */
export function toJstDateString(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Whole-day age of a bundled index from its `generated_at` ISO timestamp to
 * `now`. Returns `undefined` when `generatedAt` is unparseable.
 *
 * Single source of truth for the `bundled_age_days` formula, shared by
 * `egov-index.ts::withBundledAge` and `index-metadata.ts::list`.
 */
export function computeBundledAgeDays(
  generatedAt: string,
  now: number = Date.now(),
): number | undefined {
  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedMs)) return undefined;
  return Math.floor((now - generatedMs) / DAY_MS);
}
