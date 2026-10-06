/**
 * e-Gov API v2 のJSONレスポンスを解析して条文テキストを抽出
 *
 * takurot/egov-law-mcp の LawXMLParser を参考に、JSON版として実装:
 * - ルビ(Rt)タグのフィルタリング
 * - 再帰的サブアイテム処理（Subitem{level} の動的対応）
 * - 行蓄積パターン（lines[] + join）
 * - 条文番号の int() フォールバック
 * - 階層的Markdown変換（Part→# / Chapter→## / Section→### / Article→####）
 */

import type { EgovNode, EgovLawData } from './types.js';
import { ValidationError } from './errors.js';
import { formatSupplKey, kanjiToNumber, lawNumMatches, parseLawNum, type ParsedLawNum } from './law-num.js';

// ============================
// 条文番号の正規化
// ============================

/**
 * 条文番号を正規化する
 * "33" → "33", "33の2" → "33_2", "第33条" → "33", "33-2" → "33_2"
 */
export function normalizeArticleNum(input: string): string {
  let num = input.trim();
  num = num.replace(/^第/, '').replace(/条.*$/, '');
  num = num.replace(/の/g, '_');
  num = num.replace(/-/g, '_');
  num = num.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30));
  return num;
}

// ============================
// 公開API
// ============================

/**
 * 号の番号を正規化する（"3" / 3 / "3の2" / "三の二" / "第3号" → "3" / "3_2"）。
 * Item@Num（"3_2"）と同じ形にそろえる。変換できなければ undefined
 */
export function normalizeItemNum(input: string | number): string | undefined {
  const s = String(input).normalize('NFKC').trim().replace(/^第/, '').replace(/号/g, '');
  if (!s) return undefined;
  const parts = s.split(/[のノ_-]/);
  const nums = parts.map((part) => kanjiToNumber(part));
  if (nums.some((n) => n === undefined)) return undefined;
  return nums.join('_');
}

/**
 * 号の下の細分の指定を階層ごとの正規形に分ける
 * （"イ (1)" / "イ-(1)-(i)" / "イ（１）（ｉ）" / "イ/1/i" → ["イ", "1", "i"]）
 */
export function normalizeSubitemPath(input: string): string[] {
  const s = input.normalize('NFKC');
  const tokens: string[] = [];
  for (const m of s.matchAll(/\(([^()]+)\)|([^\s()\-/,、・.]+)/g)) {
    const token = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (token) tokens.push(token);
  }
  return tokens;
}

/** 細分の見出し（"（ｉｉｉ）"）を比較用に正規化する */
function normalizeSubitemLabel(input: string): string {
  return input.normalize('NFKC').replace(/[()\s]/g, '').toLowerCase();
}

/**
 * 条見出しの外側の括弧を外す。e-Gov の ArticleCaption は「（労働時間）」と括弧つきで届くが、
 * 表示（body の先頭で括弧を付ける）・検索キーワード・見出しの照合には括弧なしの語を使う
 */
export function normalizeArticleCaption(caption: string): string {
  const trimmed = caption.trim();
  if (!/^[（(]/.test(trimmed) || !/[）)]$/.test(trimmed)) return trimmed;
  // 先頭の括弧が末尾の括弧と対になっているときだけ外す。「（定義）（略）」は崩さず、
  // 「（車両系建設機械（整地・運搬・積込み用及び掘削用）…経過措置）」（安衛則 第3条）は外す
  let depth = 0;
  const chars = [...trimmed];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '（' || chars[i] === '(') depth++;
    else if (chars[i] === '）' || chars[i] === ')') depth--;
    if (depth === 0 && i < chars.length - 1) return trimmed;
  }
  return depth === 0 ? chars.slice(1, -1).join('').trim() : trimmed;
}

/**
 * 条文の body を組む。条全体なら本文に「#### （見出し）」の行があるのでそのまま、
 * 項・号・細分だけなら本文に条見出しが無いので先頭に「（見出し）」を 1 行足す
 */
export function formatArticleBody(result: { articleCaption?: string; text: string; captionInText?: boolean }): string {
  if (!result.articleCaption || result.captionInText === true) return result.text;
  return `（${result.articleCaption}）\n${result.text}`;
}

export interface ExtractResult {
  text: string;
  articleCaption: string;
  /** paragraph を省いて item から項を特定したときの項番号 */
  matchedParagraph?: number;
  /** text に条見出しの行（「#### （見出し）」）が含まれるか。条全体を返したときだけ true */
  captionInText: boolean;
}

export interface ExtractTarget {
  article?: string;
  paragraph?: number;
  item?: number | string;
  subitem?: string;
}

/**
 * 法令全文から本則の条文を抽出する。
 * paragraph を省いて item を渡すと全項から探し、一致が複数なら ValidationError
 */
export function extractArticle(
  lawData: EgovLawData,
  articleNum: string,
  paragraph?: number,
  item?: number | string,
  subitem?: string,
): ExtractResult | null {
  const mainProvision = findNode(lawData.law_full_text, 'MainProvision');
  if (!mainProvision) return null;
  const article = findArticleWithFallback(mainProvision, articleNum);
  if (!article) return null;
  return extractFromArticle(article, { paragraph, item, subitem });
}

function findArticleWithFallback(scope: EgovNode, articleNum: string): EgovNode | null {
  const normalized = normalizeArticleNum(articleNum);
  // 正規化した番号で検索、見つからなければ int 変換でフォールバック (takurot版参考)
  let article = findArticleNode(scope, normalized);
  if (!article) {
    const intNormalized = String(parseInt(normalized.split('_')[0], 10));
    if (intNormalized !== normalized.split('_')[0]) {
      const fallback = normalized.replace(/^\d+/, intNormalized);
      article = findArticleNode(scope, fallback);
    }
  }
  return article;
}

function extractFromArticle(article: EgovNode, target: ExtractTarget): ExtractResult | null {
  const articleCaption = normalizeArticleCaption(getText(findNode(article, 'ArticleCaption')));
  if (target.paragraph === undefined && target.item === undefined) {
    const lines: string[] = [];
    parseArticle(article, lines);
    return { text: lines.join('\n').trim(), articleCaption, captionInText: articleCaption !== '' };
  }
  const resolved = resolveInParagraphs(directChildren(article, 'Paragraph'), target);
  return resolved ? { ...resolved, articleCaption, captionInText: false } : null;
}

/** 項の並びから、項・号・細分を解決してテキスト化する */
function resolveInParagraphs(
  paragraphs: EgovNode[],
  target: ExtractTarget,
): { text: string; matchedParagraph?: number } | null {
  const render = (node: EgovNode, kind: 'paragraph' | 'item' | 'subitem'): string => {
    const lines: string[] = [];
    if (kind === 'paragraph') parseParagraph(node, lines);
    else if (kind === 'item') parseItem(node, lines, 0);
    else parseSubitem(node, lines, 0);
    return lines.join('\n').trim();
  };
  const path = target.subitem !== undefined ? normalizeSubitemPath(target.subitem) : [];
  const resolveItem = (para: EgovNode): EgovNode | null => {
    const itemNode = findItemNode(para, target.item!);
    if (!itemNode) return null;
    return path.length > 0 ? findSubitemNode(itemNode, path) : itemNode;
  };
  const leafKind = path.length > 0 ? 'subitem' : 'item';

  if (target.paragraph !== undefined) {
    const para = paragraphs.find((p) => parseInt(p.attr?.Num ?? '', 10) === target.paragraph);
    if (!para) return null;
    if (target.item === undefined) return { text: render(para, 'paragraph') };
    const node = resolveItem(para);
    return node ? { text: render(node, leafKind) } : null;
  }

  const hits: Array<{ paragraphNum: number; node: EgovNode }> = [];
  for (const para of paragraphs) {
    const node = resolveItem(para);
    if (node) hits.push({ paragraphNum: parseInt(para.attr?.Num ?? '1', 10), node });
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    const where = hits.map((h) => `第${h.paragraphNum}項`).join('、');
    throw new ValidationError(
      `指定した号は複数の項（${where}）にあります。paragraph で項を指定してください。`,
    );
  }
  return { text: render(hits[0].node, leafKind), matchedParagraph: hits[0].paragraphNum };
}

/**
 * 法令タイトルを取得する (LawTitleノードから)
 */
export function extractLawTitle(lawData: EgovLawData): string {
  const titleNode = findNode(lawData.law_full_text, 'LawTitle');
  return getText(titleNode);
}

/**
 * 法令全文の目次を取得する (takurot版の parse_toc 相当)
 */
export function extractToc(lawData: EgovLawData): string {
  const mainProvision = findNode(lawData.law_full_text, 'MainProvision');
  if (!mainProvision) return '（MainProvisionが見つかりません）';

  const lines: string[] = [];
  collectToc(mainProvision, lines, 0);
  return lines.join('\n');
}

// ============================
// 附則（SupplProvision）
// ============================

export interface SupplProvisionInfo {
  /** LawBody 内の附則の並び順（e-Gov の並び＝制定時が先頭、以降は古い順） */
  index: number;
  /** 正規形。制定時は「制定」、改正附則は「令和8年法律第46号」 */
  key: string;
  /** e-Gov の AmendLawNum（加工しない）。制定時附則は undefined */
  amendLawNum?: string;
  parsed?: ParsedLawNum;
  /** 抄 */
  extract: boolean;
  articleNums: string[];
  /** 附則ブロック直下の項の数（条を持たない附則で意味を持つ） */
  paragraphCount: number;
}

const ENACTMENT_KEY = '制定';

function supplProvisionNodes(lawData: EgovLawData): EgovNode[] {
  const body = findNode(lawData.law_full_text, 'LawBody');
  return body ? directChildren(body, 'SupplProvision') : [];
}

function collectByTag(node: EgovNode, tag: string, out: EgovNode[]): void {
  for (const child of node.children ?? []) {
    if (typeof child === 'string') continue;
    if (child.tag === tag) out.push(child);
    else collectByTag(child, tag, out);
  }
}

/** 法令中のすべての附則を e-Gov の並びで列挙する */
export function listSupplProvisions(lawData: EgovLawData): SupplProvisionInfo[] {
  return supplProvisionNodes(lawData).map((node, index) => {
    const amendLawNum = node.attr?.AmendLawNum?.trim() || undefined;
    const parsed = amendLawNum ? parseLawNum(amendLawNum) : undefined;
    const articles: EgovNode[] = [];
    collectByTag(node, 'Article', articles);
    return {
      index,
      key: amendLawNum ? (parsed ? formatSupplKey(parsed) : amendLawNum) : ENACTMENT_KEY,
      amendLawNum,
      parsed,
      extract: node.attr?.Extract === 'true',
      articleNums: articles.map((a) => (a.attr?.Num ?? '').replace(/_/g, 'の')),
      paragraphCount: directChildren(node, 'Paragraph').length,
    };
  });
}

/**
 * 附則を 1 つ選ぶ。「制定」/「制定時」は制定時附則、それ以外は改正法の法令番号（2 つの表記を受け付ける）。
 * 該当なしは null。番号の無い・解析できない入力と、複数に一致した場合は ValidationError
 */
export function selectSupplProvision(lawData: EgovLawData, query: string): SupplProvisionInfo | null {
  const all = listSupplProvisions(lawData);
  const q = query.normalize('NFKC').trim();
  if (q === ENACTMENT_KEY || q === '制定時') {
    return all.find((s) => s.amendLawNum === undefined) ?? null;
  }
  const wanted = parseLawNum(q);
  if (!wanted || wanted.number === undefined) {
    throw new ValidationError(
      `附則の指定「${query}」を解釈できません。「制定」または改正法の法令番号（例: "令和8年法律第46号"、"令和八年法律第四十六号"）を指定してください。`,
    );
  }
  const exact = all.filter((s) => s.amendLawNum === q);
  const matched = exact.length > 0 ? exact : all.filter((s) => s.parsed && lawNumMatches(wanted, s.parsed));
  if (matched.length === 0) return null;
  if (matched.length > 1) {
    throw new ValidationError(
      `附則の指定「${query}」が複数の附則に一致しました: ${matched.map((s) => s.key).join('、')}。種別まで含めて指定してください。`,
    );
  }
  return matched[0];
}

/**
 * 選んだ附則から条・項・号・細分を抽出する。article を省くと附則ブロック直下を対象にし、
 * 何も指定しなければブロック全体を返す。条を持つ附則で article を省いて項以下を指定したら ValidationError
 */
export function extractSupplProvision(
  lawData: EgovLawData,
  info: SupplProvisionInfo,
  target: ExtractTarget,
): ExtractResult | null {
  const node = supplProvisionNodes(lawData)[info.index];
  if (!node) return null;

  if (target.article !== undefined) {
    const article = findArticleWithFallback(node, target.article);
    return article ? extractFromArticle(article, target) : null;
  }

  if (target.paragraph === undefined && target.item === undefined) {
    const lines: string[] = [];
    for (const child of node.children ?? []) {
      if (typeof child === 'string') continue;
      if (child.tag === 'Article') {
        parseArticle(child, lines);
        lines.push('');
      } else if (child.tag === 'Paragraph') {
        parseParagraph(child, lines);
      }
    }
    const text = lines.join('\n').trim();
    return text ? { text, articleCaption: '', captionInText: false } : null;
  }

  const paragraphs = directChildren(node, 'Paragraph');
  if (paragraphs.length === 0) {
    throw new ValidationError(
      `この附則（${info.key}）は条で構成されています。article を指定してください（条: ${info.articleNums.join(', ')}）。`,
    );
  }
  const resolved = resolveInParagraphs(paragraphs, target);
  return resolved ? { ...resolved, articleCaption: '', captionInText: false } : null;
}

// ============================
// テキスト抽出 (takurot版の _get_text 相当)
// ============================

/**
 * ノードからテキストだけを再帰的に抽出
 * ルビ(Rt)タグをフィルタリング (takurot版参考)
 */
function getText(node: EgovNode | null): string {
  if (!node) return '';
  if (!node.children) return '';
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      parts.push(child);
    } else if (child.tag === 'Rt') {
      // ルビ（ふりがな）は除外 (takurot版参考)
      continue;
    } else if (child.tag === 'Ruby') {
      // Ruby要素: Rtを除外してテキストのみ取得
      if (child.children) {
        for (const rc of child.children) {
          if (typeof rc === 'string') {
            parts.push(rc);
          } else if (rc.tag !== 'Rt') {
            parts.push(getText(rc));
          }
        }
      }
    } else {
      parts.push(getText(child));
    }
  }
  return parts.join('');
}

// ============================
// ノード検索
// ============================

function findNode(node: EgovNode, tag: string): EgovNode | null {
  if (node.tag === tag) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const found = findNode(child, tag);
    if (found) return found;
  }
  return null;
}

function findArticleNode(node: EgovNode, normalizedNum: string): EgovNode | null {
  if (node.tag === 'Article') {
    const num = node.attr?.Num;
    if (num && normalizeArticleNum(num) === normalizedNum) {
      return node;
    }
  }
  if (!node.children) return null;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const found = findArticleNode(child, normalizedNum);
    if (found) return found;
  }
  return null;
}

function findItemNode(paragraph: EgovNode, itemNum: number | string): EgovNode | null {
  const wanted = normalizeItemNum(itemNum);
  if (wanted === undefined) return null;
  for (const child of directChildren(paragraph, 'Item')) {
    const num = child.attr?.Num;
    const actual = num !== undefined
      ? normalizeItemNum(num)
      : normalizeItemNum(getText(findDirectChild(child, 'ItemTitle')));
    if (actual === wanted) return child;
  }
  return null;
}

/** 号の下の細分（Subitem1 → Subitem2 → …）を深さ順にたどる。各階層は Num と見出しの両方で照合する */
function findSubitemNode(item: EgovNode, path: string[]): EgovNode | null {
  let current = item;
  for (let depth = 1; depth <= path.length; depth++) {
    const tag = `Subitem${depth}`;
    const token = path[depth - 1];
    const next = directChildren(current, tag).find((child) => {
      const label = normalizeSubitemLabel(getText(findDirectChild(child, `${tag}Title`)));
      return label === token || (child.attr?.Num !== undefined && child.attr.Num === token);
    });
    if (!next) return null;
    current = next;
  }
  return current;
}

function directChildren(node: EgovNode, tag: string): EgovNode[] {
  return (node.children ?? []).filter((c): c is EgovNode => typeof c !== 'string' && c.tag === tag);
}

function findDirectChild(node: EgovNode, tag: string): EgovNode | null {
  return directChildren(node, tag)[0] ?? null;
}

// ============================
// Markdown変換 (takurot版の階層マッピングを参考)
// Part → #, Chapter → ##, Section → ###, Article → ####
// ============================

/** 条文全体をパース */
function parseArticle(article: EgovNode, lines: string[]): void {
  if (!article.children) return;
  for (const child of article.children) {
    if (typeof child === 'string') continue;
    switch (child.tag) {
      case 'ArticleCaption':
        lines.push(`#### ${getText(child)}`);
        break;
      case 'ArticleTitle':
        lines.push(`**${getText(child)}**`);
        lines.push('');
        break;
      case 'Paragraph':
        parseParagraph(child, lines);
        break;
      default:
        // SupplProvisionLabel 等はスキップ
        break;
    }
  }
}

/** 項をパース */
function parseParagraph(para: EgovNode, lines: string[]): void {
  if (!para.children) return;

  let paragraphText = '';
  for (const child of para.children) {
    if (typeof child === 'string') continue;
    switch (child.tag) {
      case 'ParagraphNum':
        paragraphText += getText(child) + ' ';
        break;
      case 'ParagraphSentence':
        paragraphText += getText(child);
        break;
      case 'Item':
        // 項のテキストを先に出力
        if (paragraphText) {
          lines.push(paragraphText.trim());
          paragraphText = '';
        }
        parseItem(child, lines, 1);
        break;
      case 'TableStruct':
        if (paragraphText) {
          lines.push(paragraphText.trim());
          paragraphText = '';
        }
        lines.push('（表省略）');
        break;
      default:
        break;
    }
  }
  if (paragraphText) {
    lines.push(paragraphText.trim());
  }
}

/** 号をパース */
function parseItem(item: EgovNode, lines: string[], indentLevel: number): void {
  if (!item.children) return;
  const indent = '  '.repeat(indentLevel);

  let itemText = indent;
  for (const child of item.children) {
    if (typeof child === 'string') continue;
    switch (child.tag) {
      case 'ItemTitle':
        itemText += getText(child) + ' ';
        break;
      case 'ItemSentence':
        itemText += getText(child);
        break;
      default:
        // Subitem の再帰処理 (takurot版の _parse_subitem(level) 参考)
        if (child.tag.startsWith('Subitem')) {
          if (itemText.trim() !== indent.trim()) {
            lines.push(itemText.trim());
            itemText = indent;
          }
          parseSubitem(child, lines, indentLevel + 1);
        }
        break;
    }
  }
  if (itemText.trim()) {
    lines.push(itemText.trim());
  }
}

/**
 * サブアイテムを再帰的にパース
 * takurot版の _parse_subitem(level) を参考: 動的タグ名で任意の深さに対応
 * Subitem1 → Subitem1Title + Subitem1Sentence → Subitem2 → ...
 */
function parseSubitem(node: EgovNode, lines: string[], indentLevel: number): void {
  if (!node.children) return;
  const indent = '  '.repeat(indentLevel);

  let text = indent;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.tag.endsWith('Title')) {
      text += getText(child) + ' ';
    } else if (child.tag.endsWith('Sentence')) {
      text += getText(child);
    } else if (child.tag.startsWith('Subitem')) {
      // さらに深いサブアイテムの再帰
      if (text.trim() !== indent.trim()) {
        lines.push(text.trim());
        text = indent;
      }
      parseSubitem(child, lines, indentLevel + 1);
    }
  }
  if (text.trim()) {
    lines.push(text.trim());
  }
}

// ============================
// 目次収集
// ============================

function collectToc(node: EgovNode, lines: string[], depth: number): void {
  if (!node.children) return;

  for (const child of node.children) {
    if (typeof child === 'string') continue;

    switch (child.tag) {
      case 'Part': {
        const title = findNode(child, 'PartTitle');
        if (title) lines.push(`${'  '.repeat(depth)}# ${getText(title)}`);
        collectToc(child, lines, depth + 1);
        break;
      }
      case 'Chapter': {
        const title = findNode(child, 'ChapterTitle');
        if (title) lines.push(`${'  '.repeat(depth)}## ${getText(title)}`);
        collectToc(child, lines, depth + 1);
        break;
      }
      case 'Section': {
        const title = findNode(child, 'SectionTitle');
        if (title) lines.push(`${'  '.repeat(depth)}### ${getText(title)}`);
        collectToc(child, lines, depth + 1);
        break;
      }
      case 'Subsection': {
        const title = findNode(child, 'SubsectionTitle');
        if (title) lines.push(`${'  '.repeat(depth)}#### ${getText(title)}`);
        collectToc(child, lines, depth + 1);
        break;
      }
      case 'Division': {
        const title = findNode(child, 'DivisionTitle');
        if (title) lines.push(`${'  '.repeat(depth)}${getText(title)}`);
        collectToc(child, lines, depth + 1);
        break;
      }
      case 'Article': {
        const caption = getText(findNode(child, 'ArticleCaption'));
        const title = getText(findNode(child, 'ArticleTitle'));
        const indent = '  '.repeat(depth);
        if (caption || title) {
          lines.push(`${indent}${caption}${title ? ` ${title}` : ''}`);
        }
        break;
      }
      default:
        collectToc(child, lines, depth);
        break;
    }
  }
}
