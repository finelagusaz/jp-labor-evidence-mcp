export function buildEgovLawCanonicalId(lawId: string): string {
  return `egov:${lawId}`;
}

export function buildEgovArticleCanonicalId(
  lawId: string,
  article: string,
  paragraph?: number,
  item?: number | string,
  subitem?: string,
): string {
  return [`egov:${lawId}:article:${article}`, ...locatorParts(paragraph, item, subitem)].join(':');
}

/**
 * 附則の canonical_id。suppl key（「制定」「令和8年法律第46号」）の後に、条以下を指定した分だけ続ける
 */
export function buildEgovSupplCanonicalId(
  lawId: string,
  supplKey: string,
  article?: string,
  paragraph?: number,
  item?: number | string,
  subitem?: string,
): string {
  const parts = [`egov:${lawId}:suppl:${supplKey}`];
  if (article !== undefined) parts.push(`article:${article}`);
  return [...parts, ...locatorParts(paragraph, item, subitem)].join(':');
}

function locatorParts(paragraph?: number, item?: number | string, subitem?: string): string[] {
  const parts: string[] = [];
  if (paragraph !== undefined) parts.push(`paragraph:${paragraph}`);
  if (item !== undefined) parts.push(`item:${item}`);
  if (subitem !== undefined) parts.push(`subitem:${subitem}`);
  return parts;
}

export function buildEgovTocCanonicalId(lawId: string): string {
  return `egov:${lawId}:toc`;
}

export function buildMhlwDocumentCanonicalId(dataId: string): string {
  return `mhlw:${dataId}`;
}

export function buildMhlwCanonicalId(dataId: string, pageNo: number): string {
  return `mhlw:${dataId}:page:${pageNo}`;
}

export function buildJaishCanonicalId(url: string): string {
  return `jaish:${url}`;
}
