/** Resolve cart/order links from HTML href attributes */
export function resolveYodobashiUrl(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) {
    return null;
  }
  try {
    const baseUrl = base.endsWith('/') ? base : `${base}/`;
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

export function normalizeProductUrl(input: string): string {
  return input.trim().replace(/\s+/g, '');
}
