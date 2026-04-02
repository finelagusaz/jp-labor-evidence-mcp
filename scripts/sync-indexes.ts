import { runSyncJob } from '../src/lib/indexes/sync-runner.js';
import { runFullSync } from './sync-full-indexes.js';

runSyncJob('full', async () => {
  runFullSync();
}).catch((error) => {
  console.error('Index sync failed:', error);
  process.exit(1);
});
