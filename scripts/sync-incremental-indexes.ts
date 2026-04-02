import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getIndexFilePath } from '../src/lib/indexes/index-store.js';
import { initializeIndexes } from '../src/lib/indexes/bootstrap.js';
import { getDefaultSyncOutputPaths, runSyncJob } from '../src/lib/indexes/sync-runner.js';
import { createIncrementalSyncPlan } from '../src/lib/indexes/change-detectors.js';
import { persistEgovIndex } from '../src/lib/indexes/egov-index.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';
import { runFullSync } from './sync-full-indexes.js';

function ensureIndexDir(): void {
  const egovPath = getIndexFilePath('egov');
  mkdirSync(dirname(egovPath), { recursive: true });
}

export function runIncrementalSync(): void {
  ensureIndexDir();
  initializeIndexes();
  const plan = createIncrementalSyncPlan();

  console.log('Incremental sync plan:');
  for (const summary of plan.summaries) {
    console.log(`- ${summary.source}: added=${summary.added}, updated=${summary.updated}, removed=${summary.removed}, unknown=${summary.unknown}, full_rebuild=${summary.should_full_rebuild}${summary.reason ? ` (${summary.reason})` : ''}`);
  }

  if (plan.should_full_rebuild) {
    console.log(`Falling back to full sync: ${plan.reason ?? 'UNKNOWN_REASON'}`);
    runFullSync();
    return;
  }

  if (plan.summaries.find((summary) => summary.source === 'egov')?.updated) {
    persistEgovIndex();
  }

  tsutatsuIndexRegistry.persist('mhlw');
  tsutatsuIndexRegistry.persist('jaish');

  console.log('Indexes incrementally synced to disk.');
  for (const path of getDefaultSyncOutputPaths()) {
    console.log(`- ${path}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSyncJob('incremental', async () => {
    runIncrementalSync();
  }).catch((error) => {
    console.error('Incremental index sync failed:', error);
    process.exit(1);
  });
}
