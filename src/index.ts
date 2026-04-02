#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startObservabilityReporter } from './lib/observability-reporter.js';
import { createServer } from './server.js';

const server = createServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  startObservabilityReporter(server);
  console.error('Labor Law MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
