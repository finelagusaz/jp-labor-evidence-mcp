/**
 * 厚生労働省 法令等データベース HTTP クライアント
 * https://www.mhlw.go.jp/hourei/
 */

import { ValidationError } from './errors.js';
import { mhlwSourceAdapter } from './source-adapters/mhlw-source-adapter.js';

/**
 * 通達をキーワード検索する
 * @param keyword 検索キーワード
 * @param page ページ番号（0始まり）
 */
export async function fetchMhlwSearch(keyword: string, page = 0): Promise<string> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    throw new ValidationError('検索キーワードが空です');
  }
  if (!Number.isInteger(page) || page < 0 || page > 999) {
    throw new ValidationError(`不正なページ番号です: ${page}`);
  }
  return await mhlwSourceAdapter.fetchSearchHtml(normalizedKeyword, page);
}

/**
 * 通達本文を取得する（dataId指定）
 * @param dataId 文書ID（例: "00tb2035"）
 * @param pageNo ページ番号（デフォルト1）
 */
export async function fetchMhlwDocument(dataId: string, pageNo = 1): Promise<string> {
  const normalizedDataId = dataId.trim();
  // dataIdの形式バリデーション（英数字・ハイフン・アンダースコアのみ許可）
  if (!/^[\w-]{1,64}$/.test(normalizedDataId)) {
    throw new ValidationError(`不正なdataIdです: "${dataId}"`);
  }
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 999) {
    throw new ValidationError(`不正なページ番号です: ${pageNo}`);
  }
  return await mhlwSourceAdapter.fetchDocumentHtml(normalizedDataId, pageNo);
}

/**
 * MHLW法令等DBの通達URLを生成する
 */
export function getMhlwDocUrl(dataId: string, pageNo = 1): string {
  return `https://www.mhlw.go.jp/web/t_doc?dataId=${dataId}&dataType=1&pageNo=${pageNo}`;
}
