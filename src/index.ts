#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { emitStartupWarnings } from './lib/indexes/freshness-warnings.js';
import { initializeIndexes } from './lib/indexes/bootstrap.js';
import { startObservabilityReporter } from './lib/observability-reporter.js';
import { createServer } from './server.js';

const server = createServer();

async function main() {
  initializeIndexes();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  startObservabilityReporter(server);
  await emitStartupWarnings(server);
  console.error('jp-labor-evidence-mcp running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
