import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deserializeLawIndex, deserializeTsutatsuIndex, serializeLawIndex, serializeTsutatsuIndex, type SerializedLawIndex, type SerializedTsutatsuIndex } from './serialization.js';

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

export function hasPersistedIndex(source: 'egov' | 'mhlw' | 'jaish'): boolean {
  return existsSync(getIndexFilePath(source));
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
  ensureParentDir(filePath);
  writeFileSync(filePath, serializeLawIndex(snapshot), 'utf-8');
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
  ensureParentDir(filePath);
  writeFileSync(filePath, serializeTsutatsuIndex(snapshot), 'utf-8');
}
