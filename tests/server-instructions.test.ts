import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

describe('server instructions', () => {
  it('freshness warnings のガイダンスが instructions に含まれる', () => {
    const server = createServer();
    const internalServer = server.server as unknown as { _instructions?: string; _options?: { instructions?: string } };
    const instructions = internalServer._instructions ?? internalServer._options?.instructions;
    expect(instructions).toBeDefined();
    expect(instructions).toContain('freshness warnings');
    expect(instructions).toContain('BUNDLED_INDEX_AGED');
    expect(instructions).toContain('RUNTIME_INDEX_STALE');
  });
});
