/**
 * 厚生労働省 法令等データベース HTML パーサー
 */

import type { MhlwSearchResult } from './types.js';
import { stripTags } from './html-utils.js';

/**
 * 検索結果HTMLからエントリ一覧を抽出する
 *
 * HTML構造:
 * <table CLASS="content-main">
 *   <tr><th>件名</th><th>制定年月日</th><th>種別・番号</th></tr>
 *   <tr>
 *     <td CLASS="kenmei_td"><A HREF="t_doc_keyword?...&dataId=XXXX&..."><SPAN>・タイトル</SPAN></A></td>
 *     <td CLASS="date_td">◆平成15年05月23日</td>
 *     <td CLASS="shubetsu_td"><span>基発第523004号</span></td>
 *   </tr>
 * </table>
 */
export function parseMhlwSearchResults(html: string): MhlwSearchResult[] {
  const results: MhlwSearchResult[] = [];

  // <tr>...</tr> ブロックを抽出（ヘッダー行以外）
  const rowRegex = /<tr>\s*<td\s+CLASS="kenmei_td"[^>]*>([\s\S]*?)<\/td>\s*<td\s+CLASS="date_td"[^>]*>([\s\S]*?)<\/td>\s*<td\s+CLASS="shubetsu_td"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, kenmeiHtml, dateHtml, shubetsuHtml] = match;

    // dataId を HREF から抽出
    const dataIdMatch = kenmeiHtml.match(/dataId=([^&"]+)/);
    if (!dataIdMatch) continue;
    const dataId = dataIdMatch[1];

    // タイトルを <SPAN> から抽出し、先頭の「・」を除去
    const titleMatch = kenmeiHtml.match(/<SPAN>([\s\S]*?)<\/SPAN>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/^・/, '').replace(/\s+/g, ' ').trim()
      : '';

    // 日付を抽出（◆ を除去）
    const date = stripTags(dateHtml).replace(/^◆/, '').trim();

    // 種別・番号を抽出（複数spanの場合は改行で結合）
    const shubetsuSpans: string[] = [];
    const spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/gi;
    let spanMatch;
    while ((spanMatch = spanRegex.exec(shubetsuHtml)) !== null) {
      const text = spanMatch[1].trim();
      if (text) shubetsuSpans.push(text);
    }
    const shubetsu = shubetsuSpans.length > 0
      ? shubetsuSpans.join(' / ')
      : stripTags(shubetsuHtml).trim();

    if (title) {
      results.push({ title, dataId, date, shubetsu });
    }
  }

  return results;
}

/**
 * 検索結果HTMLから総件数を抽出する
 *
 * HTML: <H4 CLASS="toRight">該当件数: <span>28</span>件中 ...
 */
export function parseMhlwSearchCount(html: string): number {
  const match = html.match(/該当件数:\s*<span>(\d+)<\/span>/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 通達本文HTMLからテキストを抽出する
 *
 * HTML構造:
 * <div id="contents">
 *   <div class="eline"><p class="title-irregular">○タイトル</p></div>
 *   <div class="eline"><p class="date">(日付)</p></div>
 *   <div class="eline"><p class="number">(番号)</p></div>
 *   <div class="eline"><p class="p">本文...</p></div>
 *   ...
 * </div>
 */
export function parseMhlwDocument(html: string): {
  title: string;
  body: string;
  date?: string;
  number?: string;
} {
  // タイトルを <title> タグから取得
  // 例: "・タイトル(◆平成15年05月23日基発第523004号)"
  const htmlTitleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = htmlTitleMatch
    ? htmlTitleMatch[1]
        .replace(/^・/, '')
        .replace(/[(\(]◆[^)\)]*[)\)]$/, '')
        .trim()
    : '';

  // <div id="contents"> 以降のHTMLを抽出（ネストdivに対応するため開始位置から切り出し）
  const contentsStart = html.search(/<div\s+id="contents"/i);
  if (contentsStart < 0) {
    return { title, body: '' };
  }
  const contentsHtml = html.slice(contentsStart);

  // <p> タグからテキストを抽出（class属性ありなし両方対応）
  const lines: string[] = [];
  let date: string | undefined;
  let number: string | undefined;
  const pRegex = /<p[^>]*?(?:\s+class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;

  while ((pMatch = pRegex.exec(contentsHtml)) !== null) {
    const className = pMatch[1] ?? '';
    const content = pMatch[2];
    let text = stripTags(content).trim();

    if (!text) continue;

    // クラスに応じてフォーマット
    if (className.includes('title-irregular')) {
      text = `## ${text.replace(/^○/, '')}`;
    } else if (className === 'date') {
      date = text;
    } else if (className === 'number' || className === 'n-diet' || className === 'cabinet') {
      number = text;
    } else if (className === 'num') {
      text = `### ${text}`;
    }

    lines.push(text);
  }

  const body = lines.join('\n\n');

  return { title, body, date, number };
}
