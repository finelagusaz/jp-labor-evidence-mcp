import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { getServerInstructions } from './test-helpers/mcp-internals.js';

describe('server instructions', () => {
  it('freshness warnings のガイダンスが instructions に含まれる', async () => {
    const server = createServer();
    const instructions = await getServerInstructions(server);
    expect(instructions).toBeDefined();
    expect(instructions).toContain('freshness warnings');
    expect(instructions).toContain('BUNDLED_INDEX_AGED');
    expect(instructions).toContain('RUNTIME_INDEX_STALE');
    expect(instructions).toContain('retryable');
  });
});
