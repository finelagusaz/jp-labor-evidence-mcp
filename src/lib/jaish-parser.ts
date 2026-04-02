/**
 * 安全衛生情報センター（JAISH）HTML パーサー
 */

import type { JaishIndexEntry } from './types.js';
import { stripTags } from './html-utils.js';

/**
 * 年度別インデックスHTMLから通達一覧を抽出する
 *
 * HTML構造:
 * <table id="horTable03">
 *   <tbody>
 *   <tr>
 *     <td><a href="/anzen/hor/hombun/hor1-67/hor1-67-1-1-0.htm">通達名</a></td>
 *     <td>令和8年1月6日<br>基安安発0106第3号</td>
 *   </tr>
 *   </tbody>
 * </table>
 */
export function parseJaishIndex(html: string): JaishIndexEntry[] {
  const entries: JaishIndexEntry[] = [];

  // <tbody> 内の <tr> を抽出（2カラムの行のみ）
  const rowRegex = /<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, titleHtml, infoHtml] = match;

    // ヘッダー行（<th>含む）をスキップ
    if (titleHtml.includes('<th') || infoHtml.includes('<th')) continue;

    // タイトルとURLを抽出
    const linkMatch = titleHtml.match(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();

    // 日付と番号を抽出（<br>で区切られている）
    const infoParts = infoHtml.split(/<br\s*\/?>/i).map(s => stripTags(s).trim()).filter(Boolean);
    const date = infoParts[0] || '';
    const number = infoParts.slice(1).join(' / ');

    if (title) {
      entries.push({ title, number, date, url });
    }
  }

  return entries;
}

/**
 * キーワードでエントリをフィルタする
 */
export function filterJaishEntries(entries: JaishIndexEntry[], keyword: string): JaishIndexEntry[] {
  const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const text = `${entry.title} ${entry.number} ${entry.date}`.toLowerCase();
    return keywords.every((kw) => text.includes(kw));
  });
}

/**
 * 通達本文ページからテキストを抽出する
 *
 * HTML構造:
 * <div id="title"><h1>通達名</h1></div>
 * <div id="hombun">
 *   <div id="Ahead">
 *     <div class="seiteiNo">番号</div>
 *     <div class="seiteiYmd">日付</div>
 *     <div class="To1">宛先</div>
 *     <div class="To2">発出者</div>
 *   </div>
 *   <div id="pretitleL2"><h2>タイトル</h2></div>
 *   <pre>本文...</pre>
 * </div>
 */
export function parseJaishDocument(html: string): {
  title: string;
  body: string;
  date?: string;
  number?: string;
} {
  // タイトルを <title> タグから取得（「｜安全衛生情報センター」を除去）
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/[｜|]安全衛生情報センター.*$/, '').trim()
    : '';

  // <div id="hombun"> 以降のHTMLを切り出し（ネスト対応）
  const hombunStart = html.search(/<div\s+id="hombun">/i);
  const hombunHtml = hombunStart >= 0
    ? html.slice(hombunStart)
    : '';

  const lines: string[] = [];
  let date: string | undefined;
  let number: string | undefined;

  // ヘッダー情報（番号、日付、宛先、発出者）
  const noMatch = hombunHtml.match(/<div\s+class="seiteiNo">([\s\S]*?)<\/div>/i);
  const ymdMatch = hombunHtml.match(/<div\s+class="seiteiYmd">([\s\S]*?)<\/div>/i);
  if (noMatch) {
    number = stripTags(noMatch[1]).trim();
    lines.push(number);
  }
  if (ymdMatch) {
    date = stripTags(ymdMatch[1]).trim();
    lines.push(date);
  }

  // 宛先・発出者
  const toRegex = /<div\s+class="To\d+">([\s\S]*?)<\/div>/gi;
  let toMatch;
  while ((toMatch = toRegex.exec(hombunHtml)) !== null) {
    const text = stripTags(toMatch[1]).trim();
    if (text) lines.push(text);
  }

  lines.push(''); // 空行

  // 本文: <pre> タグ内のテキストを取得
  let hasPreContent = false;
  const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let preMatch;
  while ((preMatch = preRegex.exec(hombunHtml)) !== null) {
    const text = stripTags(preMatch[1]).trim();
    if (text) {
      lines.push(text);
      hasPreContent = true;
    }
  }

  // <pre>がない場合は <p> タグからテキストを取得
  if (!hasPreContent) {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch;
    while ((pMatch = pRegex.exec(hombunHtml)) !== null) {
      const text = stripTags(pMatch[1]).trim();
      if (text) lines.push(text);
    }
  }

  const body = lines.join('\n');

  return { title, body, date, number };
}
