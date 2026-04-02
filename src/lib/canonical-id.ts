export function buildEgovLawCanonicalId(lawId: string): string {
  return `egov:${lawId}`;
}

export function buildEgovArticleCanonicalId(
  lawId: string,
  article: string,
  paragraph?: number,
  item?: number,
): string {
  const parts = [`egov:${lawId}:article:${article}`];
  if (paragraph !== undefined) {
    parts.push(`paragraph:${paragraph}`);
  }
  if (item !== undefined) {
    parts.push(`item:${item}`);
  }
  return parts.join(':');
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
