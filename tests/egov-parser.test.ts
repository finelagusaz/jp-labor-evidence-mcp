import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractArticle, extractLawTitle, extractToc } from '../src/lib/egov-parser.js';
import type { EgovLawData } from '../src/lib/types.js';

function readFixture(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('egov-parser fixtures', () => {
  const lawData = JSON.parse(
    readFixture('tests/fixtures/egov/labor-standards-law.json')
  ) as EgovLawData;

  it('法令タイトルを抽出できる', () => {
    expect(extractLawTitle(lawData)).toBe('労働基準法');
  });

  it('条文全体を抽出できる', () => {
    const result = extractArticle(lawData, '32');
    expect(result).not.toBeNull();
    expect(result?.articleCaption).toBe('労働時間');
    expect(result?.text).toContain('一週間について四十時間を超えて');
    expect(result?.text).toContain('一日について八時間を超えて');
  });

  it('項指定で抽出できる', () => {
    const result = extractArticle(lawData, '第32条', 2);
    expect(result).not.toBeNull();
    expect(result?.text).toContain('一日について八時間を超えて');
    expect(result?.text).not.toContain('一週間について四十時間を超えて');
  });

  it('目次を抽出できる', () => {
    const toc = extractToc(lawData);
    expect(toc).toContain('労働時間 第三十二条');
  });
});
