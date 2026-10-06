import { buildEgovArticleCanonicalId, buildEgovSupplCanonicalId } from './canonical-id.js';
import { normalizeItemNum } from './egov-parser.js';

/** 条文の位置。paragraph は指定された項、または item から特定した項 */
export interface ArticleLocatorParts {
  supplementary?: { key: string; extract: boolean };
  article?: string;
  paragraph?: number;
  item?: number | string;
  /** 細分の正規形（"ロ/1/iii"） */
  subitem?: string;
}

/** 号の表示・識別子用の正規形（"一の二" → "1の2"、6 → "6"） */
export function itemKeyOf(item: number | string | undefined): string | undefined {
  if (item === undefined) return undefined;
  return normalizeItemNum(item)?.replace(/_/g, 'の');
}

/** 「労働基準法 附則（令和8年法律第60号・抄）第1条第2項第3号イ（1）」 */
export function buildArticleTitle(lawTitle: string, parts: ArticleLocatorParts): string {
  const supplLabel = parts.supplementary
    ? `附則（${parts.supplementary.key === '制定' ? '制定時' : parts.supplementary.key}${parts.supplementary.extract ? '・抄' : ''}）`
    : '';
  const rawArticle = parts.article?.replace(/_/g, 'の');
  const articleDisplay = rawArticle ? (/^第/.test(rawArticle) ? rawArticle : `第${rawArticle}条`) : '';
  const paraDisplay = parts.paragraph !== undefined ? `第${parts.paragraph}項` : '';
  const itemKey = itemKeyOf(parts.item);
  const itemDisplay = itemKey !== undefined ? `第${itemKey}号` : '';
  const [head, ...rest] = parts.subitem?.split('/') ?? [];
  const subitemDisplay = head !== undefined ? `${head}${rest.map((t) => `（${t}）`).join('')}` : '';
  return `${lawTitle} ${supplLabel}${articleDisplay}${paraDisplay}${itemDisplay}${subitemDisplay}`;
}

/** 附則なら egov:{law_id}:suppl:{key}…、本則なら egov:{law_id}:article:{n}… */
export function buildArticleCanonicalId(lawId: string, parts: ArticleLocatorParts): string {
  const itemKey = itemKeyOf(parts.item);
  return parts.supplementary
    ? buildEgovSupplCanonicalId(lawId, parts.supplementary.key, parts.article, parts.paragraph, itemKey, parts.subitem)
    : buildEgovArticleCanonicalId(lawId, parts.article ?? '', parts.paragraph, itemKey, parts.subitem);
}
