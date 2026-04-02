import type { IndexSnapshotMeta, LawIndexEntry, TsutatsuIndexEntry } from './types.js';

export interface SerializedLawIndex {
  meta: IndexSnapshotMeta;
  entries: LawIndexEntry[];
}

export interface SerializedTsutatsuIndex {
  meta: IndexSnapshotMeta;
  entries: TsutatsuIndexEntry[];
}

export function serializeLawIndex(index: SerializedLawIndex): string {
  return JSON.stringify(index, null, 2);
}

export function deserializeLawIndex(input: string): SerializedLawIndex {
  return JSON.parse(input) as SerializedLawIndex;
}

export function serializeTsutatsuIndex(index: SerializedTsutatsuIndex): string {
  return JSON.stringify(index, null, 2);
}

export function deserializeTsutatsuIndex(input: string): SerializedTsutatsuIndex {
  return JSON.parse(input) as SerializedTsutatsuIndex;
}
