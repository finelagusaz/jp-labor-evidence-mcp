import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

let tempDir: string | undefined;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'jp-labor-evidence-test-'));
  process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
});

afterAll(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});
