import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deserializeLawIndex, deserializeTsutatsuIndex, serializeLawIndex, serializeTsutatsuIndex, type SerializedLawIndex, type SerializedTsutatsuIndex } from './serialization.js';
import type { IndexSource } from './types.js';

function resolveIndexDir(): string {
  return process.env.LABOR_LAW_MCP_INDEX_DIR?.trim()
    ? resolve(process.env.LABOR_LAW_MCP_INDEX_DIR)
    : resolve(process.cwd(), '.labor-law-indexes');
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function getIndexFilePath(source: 'egov' | 'mhlw' | 'jaish'): string {
  return resolve(resolveIndexDir(), `${source}-index.json`);
}

export function getStagedIndexFilePath(source: IndexSource): string {
  return resolve(resolveIndexDir(), `${source}-index.stage.json`);
}

export function getLastKnownGoodIndexFilePath(source: IndexSource): string {
  return resolve(resolveIndexDir(), `${source}-index.last-known-good.json`);
}

export function getSyncLockFilePath(): string {
  return resolve(resolveIndexDir(), 'sync.lock');
}

export function getSyncStateFilePath(): string {
  return resolve(resolveIndexDir(), 'sync-state.json');
}

export function hasPersistedIndex(source: IndexSource): boolean {
  return existsSync(getIndexFilePath(source));
}

export function hasStagedIndex(source: IndexSource): boolean {
  return existsSync(getStagedIndexFilePath(source));
}

export function hasLastKnownGoodIndex(source: IndexSource): boolean {
  return existsSync(getLastKnownGoodIndexFilePath(source));
}

export function removeStagedIndex(source: IndexSource): void {
  const filePath = getStagedIndexFilePath(source);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function restoreCurrentFromLastKnownGood(source: IndexSource): void {
  const currentPath = getIndexFilePath(source);
  const lastKnownGoodPath = getLastKnownGoodIndexFilePath(source);
  ensureParentDir(currentPath);
  copyFileSync(lastKnownGoodPath, currentPath);
}

export function loadLawIndexSnapshot(source: 'egov'): SerializedLawIndex | null {
  const filePath = getIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeLawIndex(readFileSync(filePath, 'utf-8'));
}

export function saveLawIndexSnapshot(source: 'egov', snapshot: SerializedLawIndex): void {
  const filePath = getIndexFilePath(source);
  writeAtomically(filePath, serializeLawIndex(snapshot));
}

export function loadStagedLawIndexSnapshot(source: 'egov'): SerializedLawIndex | null {
  const filePath = getStagedIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeLawIndex(readFileSync(filePath, 'utf-8'));
}

export function saveStagedLawIndexSnapshot(source: 'egov', snapshot: SerializedLawIndex): void {
  const filePath = getStagedIndexFilePath(source);
  writeAtomically(filePath, serializeLawIndex(snapshot));
}

export function promoteStagedIndex(source: IndexSource): void {
  const stagedPath = getStagedIndexFilePath(source);
  const currentPath = getIndexFilePath(source);
  const lastKnownGoodPath = getLastKnownGoodIndexFilePath(source);
  ensureParentDir(currentPath);
  if (existsSync(currentPath)) {
    ensureParentDir(lastKnownGoodPath);
    copyFileSync(currentPath, lastKnownGoodPath);
  }
  renameSync(stagedPath, currentPath);
  if (!existsSync(lastKnownGoodPath)) {
    copyFileSync(currentPath, lastKnownGoodPath);
  }
}

export function loadTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish'): SerializedTsutatsuIndex | null {
  const filePath = getIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeTsutatsuIndex(readFileSync(filePath, 'utf-8'));
}

export function saveTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish', snapshot: SerializedTsutatsuIndex): void {
  const filePath = getIndexFilePath(source);
  writeAtomically(filePath, serializeTsutatsuIndex(snapshot));
}

export function loadStagedTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish'): SerializedTsutatsuIndex | null {
  const filePath = getStagedIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeTsutatsuIndex(readFileSync(filePath, 'utf-8'));
}

export function loadLastKnownGoodLawIndexSnapshot(source: 'egov'): SerializedLawIndex | null {
  const filePath = getLastKnownGoodIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeLawIndex(readFileSync(filePath, 'utf-8'));
}

export function loadLastKnownGoodTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish'): SerializedTsutatsuIndex | null {
  const filePath = getLastKnownGoodIndexFilePath(source);
  if (!existsSync(filePath)) {
    return null;
  }
  return deserializeTsutatsuIndex(readFileSync(filePath, 'utf-8'));
}

export function saveStagedTsutatsuIndexSnapshot(source: 'mhlw' | 'jaish', snapshot: SerializedTsutatsuIndex): void {
  const filePath = getStagedIndexFilePath(source);
  writeAtomically(filePath, serializeTsutatsuIndex(snapshot));
}

function writeAtomically(filePath: string, content: string): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, content, 'utf-8');
  const fd = openSync(tempPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}
