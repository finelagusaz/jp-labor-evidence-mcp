import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getIndexFilePath } from '../src/lib/indexes/index-store.js';
import { initializeIndexes } from '../src/lib/indexes/bootstrap.js';
import { getDefaultSyncOutputPaths, runSyncJob } from '../src/lib/indexes/sync-runner.js';
import { persistEgovIndex } from '../src/lib/indexes/egov-index.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

function ensureIndexDir(): void {
  const egovPath = getIndexFilePath('egov');
  mkdirSync(dirname(egovPath), { recursive: true });
}

export function runFullSync(): void {
  ensureIndexDir();
  initializeIndexes();

  persistEgovIndex();
  tsutatsuIndexRegistry.persist('mhlw');
  tsutatsuIndexRegistry.persist('jaish');

  console.log('Indexes fully synced to disk.');
  for (const path of getDefaultSyncOutputPaths()) {
    console.log(`- ${path}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSyncJob('full', async () => {
    runFullSync();
  }).catch((error) => {
    console.error('Full index sync failed:', error);
    process.exit(1);
  });
}
