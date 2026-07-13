export type LawVerificationStatus = 'OK' | 'NAME_MISMATCH' | 'NOT_FOUND' | 'ERROR';

/** Fetch outcome for a single law: the fetched official title, or an error message. */
export type FetchOutcome =
  | { ok: true; title: string }
  | { ok: false; errorMessage: string };

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
 * Classify an HTTP/adapter error message. The e-Gov adapter throws
 * `Error("HTTP {status} ...")` for non-2xx and `Error("Circuit breaker is open ...")`
 * when the breaker is tripped; only a 404 is a real NOT_FOUND, everything else
 * (5xx, timeout, circuit-open) is an unconfirmed ERROR.
 */
export function classifyFetchError(errorMessage: string): 'NOT_FOUND' | 'ERROR' {
  return /HTTP 404\b/.test(errorMessage) ? 'NOT_FOUND' : 'ERROR';
}

/** Classify a single law's verification outcome. */
export function classifyResult(expectedName: string, outcome: FetchOutcome): LawVerificationStatus {
  if (!outcome.ok) {
    return classifyFetchError(outcome.errorMessage);
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
