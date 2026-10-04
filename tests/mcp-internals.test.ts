import { describe, expect, it } from 'vitest';
import { MCP_SDK_PINNED_VERSION, getInstalledMcpSdkVersion } from './test-helpers/mcp-internals.js';

describe('MCP SDK version guard (#7)', () => {
  // 不一致になったら test-helpers/mcp-internals.ts と tests/modern-protocol.test.ts の
  // 前提（InMemoryTransport / Client / serveStdio の挙動）を再検証し、
  // 問題なければ MCP_SDK_PINNED_VERSION を更新すること。
  // server / client はそれぞれ core を exact pin するため、ずれると core が二重に入る。
  it.each(['server', 'client', 'core'] as const)('@modelcontextprotocol/%s が pin と一致する', (pkg) => {
    expect(getInstalledMcpSdkVersion(pkg)).toBe(MCP_SDK_PINNED_VERSION);
  });
});
