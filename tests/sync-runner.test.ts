import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSyncLockFilePath, getSyncStateFilePath } from '../src/lib/indexes/index-store.js';
import { readSyncState, runSyncJob, SyncJobLockedError } from '../src/lib/indexes/sync-runner.js';

describe('sync runner', () => {
  let tempDir: string;
  let previousIndexDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'labor-law-sync-runner-'));
    previousIndexDir = process.env.LABOR_LAW_MCP_INDEX_DIR;
    process.env.LABOR_LAW_MCP_INDEX_DIR = tempDir;
  });

  afterEach(() => {
    if (previousIndexDir === undefined) {
      delete process.env.LABOR_LAW_MCP_INDEX_DIR;
    } else {
      process.env.LABOR_LAW_MCP_INDEX_DIR = previousIndexDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sync job の state を pending から promoted まで更新する', async () => {
    await runSyncJob('full', async () => {
      const during = readSyncState();
      expect(during?.status).toBe('running');
    });

    const state = readSyncState();
    expect(state?.mode).toBe('full');
    expect(state?.status).toBe('promoted');
    expect(state?.started_at).toBeDefined();
    expect(state?.finished_at).toBeDefined();
    expect(state?.promoted_at).toBeDefined();
    expect(existsSync(getSyncLockFilePath())).toBe(false);
    expect(existsSync(getSyncStateFilePath())).toBe(true);
  });

  it('lock file があると並行実行を拒否する', async () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(getSyncLockFilePath(), '123\n', 'utf-8');

    await expect(runSyncJob('incremental', async () => {})).rejects.toBeInstanceOf(SyncJobLockedError);
  });

  it('失敗時は failed state を残す', async () => {
    await expect(
      runSyncJob('incremental', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const state = readSyncState();
    expect(state?.status).toBe('failed');
    expect(state?.error).toContain('boom');
    expect(existsSync(getSyncLockFilePath())).toBe(false);
  });
});
