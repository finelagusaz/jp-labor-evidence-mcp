/** One day in milliseconds. Single source of truth for index time math. */
export const DAY_MS = 24 * 60 * 60 * 1000;

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
