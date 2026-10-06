import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * runtime 索引の保存先を test ごとの一時ディレクトリにする。
 * 通達検索は結果をディスクの索引へ反映し、反映前にディスクの内容を取り込むため、
 * リポジトリ内の .jp-labor-evidence-indexes/ を使うと前回の実行の内容で結果が変わりうる
 */
export function useTempIndexDir(): void {
  let tempDir: string;
  let previous: string | undefined;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-index-'));
    previous = process.env.LABOR_LAW_MCP_INDEX_DIR;
    process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.LABOR_LAW_MCP_INDEX_DIR;
    else process.env.LABOR_LAW_MCP_INDEX_DIR = previous;
    rmSync(tempDir, { recursive: true, force: true });
  });
}
