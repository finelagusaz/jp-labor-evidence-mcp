/**
 * MCP SDK internal-access shim for integration tests.
 *
 * The MCP TypeScript SDK does not (yet) expose public test helpers for
 * invoking a registered tool or reading a server's `instructions`, so these
 * tests reach into SDK-private fields. Centralising that access HERE keeps the
 * SDK-version coupling in one place — see Issue #7.
 *
 * Validated against @modelcontextprotocol/sdk 1.29.0. When the installed SDK
 * version changes, `tests/mcp-internals.test.ts` goes red: re-verify the field
 * names below (`server.server._requestHandlers`, `_instructions` /
 * `_options.instructions`) still hold, then bump `MCP_SDK_PINNED_VERSION`.
 * Prefer migrating to a public API if the SDK grows one (e.g.
 * `server.callTool(...)` / `server.getInstructions()`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** SDK version whose internals the shims below were validated against. */
export const MCP_SDK_PINNED_VERSION = '1.29.0';

/** Reads the actually-installed @modelcontextprotocol/sdk version from disk. */
export function getInstalledMcpSdkVersion(): string {
  const pkgUrl = new URL(
    '../../node_modules/@modelcontextprotocol/sdk/package.json',
    import.meta.url,
  );
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version: string };
  return pkg.version;
}

type RequestHandler = (req: unknown) => Promise<{ structuredContent?: unknown }>;

/**
 * Invokes a registered tool through the SDK's internal `tools/call` request
 * handler and returns its `structuredContent`.
 *
 * SDK-private: `server.server._requestHandlers`.
 */
export async function callTool<T = unknown>(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const internal = server.server as unknown as {
    _requestHandlers: Map<string, RequestHandler>;
  };
  const handler = internal._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  const result = await handler({
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return result.structuredContent as T;
}

/**
 * Reads the server's `instructions` string.
 *
 * SDK-private: `_instructions` (newer SDK) with `_options.instructions`
 * fallback (older SDK).
 */
export function getServerInstructions(server: McpServer): string | undefined {
  const internal = server.server as unknown as {
    _instructions?: string;
    _options?: { instructions?: string };
  };
  return internal._instructions ?? internal._options?.instructions;
}
