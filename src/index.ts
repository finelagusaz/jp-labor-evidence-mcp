#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { emitStartupWarnings } from './lib/indexes/freshness-warnings.js';
import { initializeIndexes } from './lib/indexes/bootstrap.js';
import { createServer } from './server.js';

function main() {
  initializeIndexes();
  // serveStdio は接続の最初のメッセージでプロトコル世代を判定する。
  // 2026-07-28（server/discover）と 2025 系（initialize）の両方を同じ factory で配信する。
  serveStdio(() => createServer(), {
    onerror: (error) => console.error('[jp-labor-evidence-mcp] transport error:', error),
  });
  emitStartupWarnings();
  console.error('jp-labor-evidence-mcp running on stdio');
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
