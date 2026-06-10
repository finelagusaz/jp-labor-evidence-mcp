import { describe, expect, it } from 'vitest';
import { MCP_SDK_PINNED_VERSION, getInstalledMcpSdkVersion } from './test-helpers/mcp-internals.js';

describe('MCP SDK internal-access guard (#7)', () => {
  it('インストール済み SDK バージョンが pin と一致する', () => {
    // 不一致になったら test-helpers/mcp-internals.ts の private field アクセスを
    // 再検証し、問題なければ MCP_SDK_PINNED_VERSION を更新すること。
    expect(getInstalledMcpSdkVersion()).toBe(MCP_SDK_PINNED_VERSION);
  });
});
