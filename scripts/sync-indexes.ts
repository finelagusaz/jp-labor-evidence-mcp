import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getIndexFilePath, saveTsutatsuIndexSnapshot } from '../src/lib/indexes/index-store.js';
import { initializeIndexes } from '../src/lib/indexes/bootstrap.js';
import { persistEgovIndex } from '../src/lib/indexes/egov-index.js';
import { tsutatsuIndexRegistry } from '../src/lib/indexes/tsutatsu-index.js';

function ensureIndexDir(): void {
  const egovPath = getIndexFilePath('egov');
  mkdirSync(dirname(egovPath), { recursive: true });
}

function main(): void {
  ensureIndexDir();
  initializeIndexes();

  persistEgovIndex();
  saveTsutatsuIndexSnapshot('mhlw', tsutatsuIndexRegistry.getSnapshot('mhlw'));
  saveTsutatsuIndexSnapshot('jaish', tsutatsuIndexRegistry.getSnapshot('jaish'));

  console.log('Indexes synced to disk.');
  console.log(`- ${getIndexFilePath('egov')}`);
  console.log(`- ${getIndexFilePath('mhlw')}`);
  console.log(`- ${getIndexFilePath('jaish')}`);
}

main();
