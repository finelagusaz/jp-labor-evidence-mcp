/**
 * MCP client harness for integration tests.
 *
 * v1 (`@modelcontextprotocol/sdk`) had no public way to invoke a tool or read
 * `instructions` in-process, so these helpers reached into SDK-private fields
 * (Issue #7). v2 ships `InMemoryTransport` + `Client`, so the helpers now go
 * through the public API only: each `McpServer` is connected once to an
 * in-memory `Client`, and calls flow over the real `tools/call` /
 * `initialize` wire exchange (including server-side outputSchema validation).
 *
 * Caveat: `InMemoryTransport` speaks the 2025-era protocol only. The
 * 2026-07-28 path (`serveStdio` → `server/discover`) is not covered here —
 * smoke it by piping a `server/discover` request into `node dist/index.js`.
 *
 * `tests/mcp-internals.test.ts` pins the installed SDK version so a bump
 * forces a deliberate re-check of the behaviours above.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';

/** SDK version the harness below was validated against. */
export const MCP_SDK_PINNED_VERSION = '2.3.0';

/** Reads the actually-installed @modelcontextprotocol/server version from disk. */
export function getInstalledMcpSdkVersion(): string {
  const pkgUrl = new URL(
    '../../node_modules/@modelcontextprotocol/server/package.json',
    import.meta.url,
  );
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version: string };
  return pkg.version;
}

// An McpServer can only be connected to one transport, so reuse the client.
const clients = new WeakMap<McpServer, Promise<Client>>();

function connectClient(server: McpServer): Promise<Client> {
  let client = clients.get(server);
  if (!client) {
    client = (async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const c = new Client({ name: 'jp-labor-evidence-mcp-tests', version: '0.0.0' });
      await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
      return c;
    })();
    clients.set(server, client);
  }
  return client;
}

/** Invokes a registered tool over the in-memory wire and returns its `structuredContent`. */
export async function callTool<T = unknown>(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const client = await connectClient(server);
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent as T;
}

/** Reads the server's `instructions` as delivered to a connecting client. */
export async function getServerInstructions(server: McpServer): Promise<string | undefined> {
  const client = await connectClient(server);
  return client.getInstructions();
}
