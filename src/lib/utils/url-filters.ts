export interface UrlExclusion {
  id: number;
  pattern: string;
  kind: 'exact' | 'mask' | 'not_contains';
}

/** Plain text matches a substring; * matches any text and ? one character.
 * All other characters are literal. No user-provided regular expressions. */
export function urlMatchesMask(url: string, mask: string): boolean {
  const pattern = mask.trim();
  if (!pattern) return true;
  if (!/[?*]/.test(pattern)) return url.toLowerCase().includes(pattern.toLowerCase());
  // Match a substring as a glob with implicit leading/trailing stars.
  // Iterative matching avoids exponential regular-expression backtracking.
  const glob = ('*' + pattern.toLowerCase() + '*').replace(/\*+/g, '*');
  const text = url.toLowerCase();
  let pos = 0, token = 0, star = -1, retry = 0;
  while (pos < text.length) {
    if (glob[token] === '*') { star = token++; retry = pos; }
    else if (glob[token] === '?' || glob[token] === text[pos]) { token++; pos++; }
    else if (star >= 0) { token = star + 1; pos = ++retry; }
    else return false;
  }
  while (glob[token] === '*') token++;
  return token === glob.length;
}

export function urlExcluded(url: string, exclusions: UrlExclusion[]): boolean {
  return exclusions.some((e) => e.kind === 'exact' ? url === e.pattern : e.kind === 'not_contains' ? !urlMatchesMask(url, e.pattern) : urlMatchesMask(url, e.pattern));
}

export function siteHostname(site: string): string {
  const raw = site.startsWith('sc-domain:') ? `https://${site.slice(10)}/` : site;
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
}

/** Resolve only a path; the current property fixes the origin. */
export function customPurchaseUrl(input: string, site: string): string {
  const raw = input.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Введи только путь, начинающийся с /, например /page/');
  }
  if (raw.length > 2000) throw new Error('Путь должен быть не длиннее 2000 символов');
  const base = site.startsWith('sc-domain:') ? `https://${site.slice(10)}/` : site;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new Error('Укажи корректный URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Нужен HTTP(S) URL без логина и порта');
  }
  if (siteHostname(url.href) !== siteHostname(site)) throw new Error('URL должен принадлежать этому домену');
  url.hash = '';
  return url.href;
}
