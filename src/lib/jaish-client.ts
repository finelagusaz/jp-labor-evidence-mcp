/**
 * 安全衛生情報センター（JAISH）HTTP クライアント
 * https://www.jaish.gr.jp/
 */

import { ValidationError } from './errors.js';
import { jaishSourceAdapter } from './source-adapters/jaish-source-adapter.js';

/**
 * 年度別インデックスページのパス一覧（新しい順）
 */
export const JAISH_INDEX_PAGES = [
  '/user/anzen/hor/tsutatsu.html',        // 令和8年（最新）
  '/user/anzen/hor/tsutatsu_r07.html',    // 令和7年
  '/user/anzen/hor/tsutatsu_r06.html',    // 令和6年
  '/user/anzen/hor/tsutatsu_r05.html',    // 令和5年
  '/user/anzen/hor/tsutatsu_r04.html',    // 令和4年
  '/user/anzen/hor/tsutatsu_r03.html',    // 令和3年
  '/user/anzen/hor/tsutatsu_r02.html',    // 令和2年
  '/user/anzen/hor/tsutatsu_h31.html',    // 平成31年・令和元年
  '/user/anzen/hor/tsutatsu_h30.html',    // 平成30年
  '/user/anzen/hor/tsutatsu_h29.html',    // 平成29年
  '/user/anzen/hor/tsutatsu_h28.html',    // 平成28年
  '/user/anzen/hor/tsutatsu_h27.html',    // 平成27年
  '/user/anzen/hor/tsutatsu_h26.html',    // 平成26年
  '/user/anzen/hor/tsutatsu_h25.html',    // 平成25年
  '/user/anzen/hor/tsutatsu_h24.html',    // 平成24年
  '/user/anzen/hor/tsutatsu_h23.html',    // 平成23年
  '/user/anzen/hor/tsutatsu_h22.html',    // 平成22年
  '/user/anzen/hor/tsutatsu_h21.html',    // 平成21年
  '/user/anzen/hor/tsutatsu_h20.html',    // 平成20年
  '/user/anzen/hor/tsutatsu_h19.html',    // 平成19年
  '/user/anzen/hor/tsutatsu_h18.html',    // 平成18年
  '/user/anzen/hor/tsutatsu_h17.html',    // 平成17年
  '/user/anzen/hor/tsutatsu_h16.html',    // 平成16年
  '/user/anzen/hor/tsutatsu_h15.html',    // 平成15年
];

/**
 * インデックスページを取得する（24hキャッシュ）
 */
export async function fetchJaishIndex(path: string): Promise<string> {
  if (!JAISH_INDEX_PAGES.includes(path)) {
    throw new ValidationError(`不正なJAISH年度インデックスです: ${path}`);
  }
  return await jaishSourceAdapter.fetchIndexHtml(path);
}

/** JAISH配下の許可パスプレフィックス */
const ALLOWED_PATH_PREFIXES = ['/anzen/', '/horei/', '/user/'];

/**
 * パスを検証してJAISH配下のみ許可する（SSRF防止）
 */
export function validateJaishPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ValidationError('JAISH のパスまたは URL を指定してください。');
  }

  const path = trimmed.startsWith('http')
    ? new URL(input).pathname
    : trimmed;
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new ValidationError(`不正なパスです。JAISH配下のパスを指定してください: ${input}`);
  }
  return path;
}

/**
 * 個別通達ページを取得する
 * @param path 通達ページのパス（例: "/anzen/hor/hombun/hor1-67/hor1-67-1-1-0.htm"）
 */
export async function fetchJaishPage(path: string): Promise<string> {
  const safePath = validateJaishPath(path);
  return await jaishSourceAdapter.fetchPageHtml(safePath);
}

/**
 * JAISH通達ページの完全URLを生成する
 */
export function getJaishUrl(path: string): string {
  const safePath = validateJaishPath(path);
  return `https://www.jaish.gr.jp${safePath}`;
}
