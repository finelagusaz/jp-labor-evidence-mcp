import { initializeEgovIndex } from './egov-index.js';
import { tsutatsuIndexRegistry } from './tsutatsu-index.js';

export function initializeIndexes(): void {
  initializeEgovIndex();
  tsutatsuIndexRegistry.loadFromDisk('mhlw');
  tsutatsuIndexRegistry.loadFromDisk('jaish');
}
