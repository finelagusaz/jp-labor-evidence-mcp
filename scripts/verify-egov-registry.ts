// Maintainer-only. NETWORK-DEPENDENT — hits the live e-Gov API v2.
// NOT for CI / release:check / prepublishOnly (design spec §1). Run in a fresh
// process so the 1h in-memory raw cache (lawDataRawCache) starts cold.
import { writeFileSync } from 'node:fs';
import { LAW_ID_MAP } from '../src/lib/law-registry.js';
import { egovSourceAdapter } from '../src/lib/source-adapters/egov-source-adapter.js';
import { extractLawTitle } from '../src/lib/egov-parser.js';
import { verifyRegistry } from '../src/lib/indexes/registry-verification.js';

const REPORT_PATH = process.env.EGOV_VERIFY_OUT ?? 'egov-verify-report.json';

async function main(): Promise<void> {
  const entries = Object.entries(LAW_ID_MAP);
  const report = await verifyRegistry(
    entries,
    async (lawId) => extractLawTitle(await egovSourceAdapter.fetchLawDataById(lawId)),
    new Date().toISOString()
  );

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`e-Gov registry verification — ${report.verifiedAt}`);
  console.log(
    `  total=${report.total} OK=${report.counts.OK} ` +
      `NAME_MISMATCH=${report.counts.NAME_MISMATCH} ` +
      `NOT_FOUND=${report.counts.NOT_FOUND} ERROR=${report.counts.ERROR}`
  );
  for (const r of report.results) {
    if (r.status !== 'OK') {
      console.log(
        `  [${r.status}] ${r.lawId} expected="${r.expectedName}" ` +
          `actual="${r.actualName ?? ''}" ${r.error ?? ''}`
      );
    }
  }
  console.log(`report written to ${REPORT_PATH}`);

  if (!report.allOk) {
    console.error(
      `NOT ALL OK — ${report.total - report.counts.OK} 件が要確認。GENERATED_AT bump は保留。`
    );
    process.exit(1);
  }
  console.log('全件 OK。GENERATED_AT bump ゲート充足（検証日を bump 日と一致させること）。');
}

main().catch((error) => {
  console.error('verify-egov-registry failed:', error);
  process.exit(1);
});
