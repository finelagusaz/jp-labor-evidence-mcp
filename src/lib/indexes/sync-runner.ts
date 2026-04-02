import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getIndexFilePath, getSyncLockFilePath, getSyncStateFilePath } from './index-store.js';

export type SyncMode = 'full' | 'incremental';
export type SyncJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'promoted';

export interface SyncJobState {
  mode: SyncMode;
  status: SyncJobStatus;
  started_at: string;
  finished_at?: string;
  promoted_at?: string;
  error?: string;
}

export class SyncJobLockedError extends Error {
  constructor() {
    super('Another sync job is already running.');
    this.name = 'SyncJobLockedError';
  }
}

export async function runSyncJob<T>(mode: SyncMode, task: () => Promise<T> | T): Promise<T> {
  const release = acquireSyncLock();
  const startedAt = new Date().toISOString();
  writeSyncState({
    mode,
    status: 'pending',
    started_at: startedAt,
  });

  try {
    writeSyncState({
      mode,
      status: 'running',
      started_at: startedAt,
    });

    const result = await task();
    const finishedAt = new Date().toISOString();

    writeSyncState({
      mode,
      status: 'succeeded',
      started_at: startedAt,
      finished_at: finishedAt,
    });

    writeSyncState({
      mode,
      status: 'promoted',
      started_at: startedAt,
      finished_at: finishedAt,
      promoted_at: finishedAt,
    });

    return result;
  } catch (error) {
    writeSyncState({
      mode,
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    release();
  }
}

export function readSyncState(): SyncJobState | null {
  const statePath = getSyncStateFilePath();
  if (!existsSync(statePath)) {
    return null;
  }
  return JSON.parse(readFileSync(statePath, 'utf-8')) as SyncJobState;
}

function writeSyncState(state: SyncJobState): void {
  const statePath = getSyncStateFilePath();
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function acquireSyncLock(): () => void {
  const lockPath = getSyncLockFilePath();
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch {
    throw new SyncJobLockedError();
  }
  writeFileSync(fd, `${process.pid}\n`, 'utf-8');
  return () => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  };
}

export function getDefaultSyncOutputPaths(): string[] {
  return [
    getIndexFilePath('egov'),
    getIndexFilePath('mhlw'),
    getIndexFilePath('jaish'),
  ];
}
