// GSC API возвращает siteUrl двух форматов:
//   - URL-prefix property: 'https://example.com/' — обычный URL
//   - Domain property:     'sc-domain:example.com' — без схемы
// displaySite() возвращает читаемое имя без 'sc-domain:'.
// siteHref() даёт валидный URL для <a href>.

export function displaySite(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length);
  return siteUrl;
}

// Bare host, identical for both GSC property forms and Bing (which keys by host).
// Used as the merge key when combining GSC + Bing keys across property types.
export function siteDomain(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length);
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

export function siteHref(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}

// Google-поиск `site:domain` для ручной проверки индексации.
// Для domain-property — голый домен; для URL-prefix — host+path без схемы.
export function siteSearchHref(siteUrl: string): string {
  const target = siteUrl.startsWith('sc-domain:')
    ? siteUrl.slice('sc-domain:'.length)
    : siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${target}`)}`;
}

// Open this site's Bing Webmaster Tools dashboard.
export function bingWebmasterHref(siteUrl: string): string {
  return `https://www.bing.com/webmasters/home?siteUrl=${siteHref(siteUrl)}`;
}
