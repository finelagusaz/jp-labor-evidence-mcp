#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { emitStartupWarnings } from './lib/indexes/freshness-warnings.js';
import { initializeIndexes } from './lib/indexes/bootstrap.js';
import { createServer } from './server.js';

function main() {
  initializeIndexes();
  // serveStdio は factory を最初の要求が届いてから呼ぶため、登録エラーがあっても
  // 起動は成功したように見えてしまう。起動時に一度組み立てて fail-fast させる。
  createServer();
  // serveStdio は接続の最初のメッセージでプロトコル世代を判定する。
  // 2026-07-28（server/discover）と 2025 系（initialize）の両方を同じ factory で配信する。
  // onerror は通信中の軽微なエラーでも呼ばれるため、記録のみで終了はしない。
  serveStdio(() => createServer(), {
    onerror: (error) => console.error('[jp-labor-evidence-mcp] transport error:', error),
  });
  emitStartupWarnings();
  console.error('jp-labor-evidence-mcp running on stdio');
}

// 起動時の初期化（index 読み込み・server 組み立て）の失敗はここで止める。
try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
