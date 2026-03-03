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
 * 法令全文から特定の条文を抽出する
 */
export function extractArticle(
  lawData: EgovLawData,
  articleNum: string,
  paragraph?: number,
  item?: number,
): { text: string; articleCaption: string } | null {
  const normalized = normalizeArticleNum(articleNum);
  const mainProvision = findNode(lawData.law_full_text, 'MainProvision');
  if (!mainProvision) return null;

  // 正規化した番号で検索、見つからなければ int 変換でフォールバック (takurot版参考)
  let article = findArticleNode(mainProvision, normalized);
  if (!article) {
    const intNormalized = String(parseInt(normalized.split('_')[0], 10));
    if (intNormalized !== normalized.split('_')[0]) {
      const fallback = normalized.replace(/^\d+/, intNormalized);
      article = findArticleNode(mainProvision, fallback);
    }
  }
  if (!article) return null;

  const caption = getText(findNode(article, 'ArticleCaption'));
  const lines: string[] = [];

  if (paragraph !== undefined) {
    const para = findParagraphNode(article, paragraph);
    if (!para) return null;
    if (item !== undefined) {
      const itemNode = findItemNode(para, item);
      if (!itemNode) return null;
      parseItem(itemNode, lines, 0);
    } else {
      parseParagraph(para, lines);
    }
  } else {
    parseArticle(article, lines);
  }

  return { text: lines.join('\n').trim(), articleCaption: caption };
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

function findParagraphNode(article: EgovNode, paragraphNum: number): EgovNode | null {
  if (!article.children) return null;
  for (const child of article.children) {
    if (typeof child === 'string') continue;
    if (child.tag === 'Paragraph') {
      const num = child.attr?.Num;
      if (num && parseInt(num, 10) === paragraphNum) return child;
    }
  }
  return null;
}

function findItemNode(paragraph: EgovNode, itemNum: number): EgovNode | null {
  if (!paragraph.children) return null;
  for (const child of paragraph.children) {
    if (typeof child === 'string') continue;
    if (child.tag === 'Item') {
      const num = child.attr?.Num;
      if (num && parseInt(num, 10) === itemNum) return child;
    }
  }
  return null;
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
