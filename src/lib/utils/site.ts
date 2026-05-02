// GSC API возвращает siteUrl двух форматов:
//   - URL-prefix property: 'https://example.com/' — обычный URL
//   - Domain property:     'sc-domain:example.com' — без схемы
// displaySite() возвращает читаемое имя без 'sc-domain:'.
// siteHref() даёт валидный URL для <a href>.

export function displaySite(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length);
  return siteUrl;
}

export function siteHref(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}
