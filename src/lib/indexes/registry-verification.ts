export type LawVerificationStatus = 'OK' | 'NAME_MISMATCH' | 'NOT_FOUND' | 'ERROR';

import { NotFoundError } from '../errors.js';

/** Fetch outcome for a single law: the fetched official title, or the error. */
export type FetchOutcome =
  | { ok: true; title: string }
  | { ok: false; errorMessage: string; notFound: boolean };

export interface LawVerificationResult {
  lawId: string;
  expectedName: string;
  status: LawVerificationStatus;
  actualName?: string;
  error?: string;
}

export interface VerificationReport {
  /** ISO timestamp (UTC) at which verification ran. */
  verifiedAt: string;
  total: number;
  counts: Record<LawVerificationStatus, number>;
  allOk: boolean;
  results: LawVerificationResult[];
}

/**
 * Normalize a law title for comparison: NFKC (full/half-width unification) then
 * strip all whitespace. Japanese law titles carry no meaningful internal spaces,
 * so surface whitespace / width differences must not count as a name mismatch.
 */
export function normalizeLawTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, '');
}

/**
 * Classify an adapter error. The adapter throws UpstreamNotFoundError (a NotFoundError)
 * for a 404; only that is a real NOT_FOUND. Everything else (5xx, timeout,
 * circuit-open, parse failure) is an unconfirmed ERROR.
 */
export function classifyFetchError(error: unknown): 'NOT_FOUND' | 'ERROR' {
  return error instanceof NotFoundError ? 'NOT_FOUND' : 'ERROR';
}

/** Classify a single law's verification outcome. */
export function classifyResult(expectedName: string, outcome: FetchOutcome): LawVerificationStatus {
  if (!outcome.ok) {
    return outcome.notFound ? 'NOT_FOUND' : 'ERROR';
  }
  return normalizeLawTitle(outcome.title) === normalizeLawTitle(expectedName) ? 'OK' : 'NAME_MISMATCH';
}

/** Aggregate per-law results. allOk iff there is ≥1 entry and every entry is OK. */
export function summarizeReport(
  results: LawVerificationResult[],
  verifiedAt: string
): VerificationReport {
  const counts: Record<LawVerificationStatus, number> = {
    OK: 0,
    NAME_MISMATCH: 0,
    NOT_FOUND: 0,
    ERROR: 0,
  };
  for (const r of results) counts[r.status] += 1;
  return {
    verifiedAt,
    total: results.length,
    counts,
    allOk: results.length > 0 && counts.OK === results.length,
    results,
  };
}

/**
 * The irreversible bump gate: the SAME-run report must be all-OK AND its
 * verification date (UTC day) must equal the intended bump date. Guards against
 * reusing a stale "all OK" report for a later-dated bump.
 */
export function isBumpGateSatisfied(report: VerificationReport, bumpDateIsoDay: string): boolean {
  if (!report.allOk) return false;
  return report.verifiedAt.slice(0, 10) === bumpDateIsoDay;
}

/**
 * Verify (name → lawId) registry entries against a title fetcher, sequentially
 * (so the caller's rate limiting / single concurrency is respected). A rejected
 * fetch is captured as NOT_FOUND/ERROR — one failing law never aborts the run.
 */
export async function verifyRegistry(
  entries: ReadonlyArray<readonly [string, string]>,
  fetchTitle: (lawId: string) => Promise<string>,
  verifiedAt: string
): Promise<VerificationReport> {
  const results: LawVerificationResult[] = [];
  for (const [expectedName, lawId] of entries) {
    let outcome: FetchOutcome;
    try {
      outcome = { ok: true, title: await fetchTitle(lawId) };
    } catch (error) {
      outcome = {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        notFound: classifyFetchError(error) === 'NOT_FOUND',
      };
    }
    results.push({
      lawId,
      expectedName,
      status: classifyResult(expectedName, outcome),
      actualName: outcome.ok ? outcome.title : undefined,
      error: outcome.ok ? undefined : outcome.errorMessage,
    });
  }
  return summarizeReport(results, verifiedAt);
}
