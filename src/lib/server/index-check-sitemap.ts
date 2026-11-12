import { Parser } from 'htmlparser2';
import { gunzipSync } from 'node:zlib';
import { readPublicDocument } from './backlink-fetch';
import { domainUrl } from './neuralindexer';
import { siteHref } from '$lib/utils/site';

export const INDEX_CHECK_URL_LIMIT = 5000;
export function parseCheckSitemap(xml: string): { index: boolean; locs: string[] } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD и XML-сущности в sitemap не поддерживаются');
  const stack: string[] = [], locs: string[] = [];
  let root = '', loc = '', invalid = false;
  const parser: Parser = new Parser({
    onopentag(name) {
      stack.push(name);
      if (!root) root = name;
      if (stack.length === 3 && name === (root.includes(':') ? root.split(':')[0] + ':loc' : 'loc')) loc = '';
    },
    ontext(value) { if (stack.length === 3 && stack[2].split(':').pop() === 'loc') loc += value; },
    onclosetag(name, implied) {
      const path = [...stack];
      const prefix = root.slice(0, root.lastIndexOf(':') + 1);
      // htmlparser2 also marks valid /> closures as implied.
      const selfClosing = xml[parser.startIndex + 1] !== '/' && xml[parser.endIndex - 1] === '/';
      if (stack.pop() !== name || (implied && !selfClosing)) invalid = true;
      if (path.length === 3 && path[2] === prefix + 'loc' &&
        ((root === prefix + 'urlset' && path[1] === prefix + 'url') || (root === prefix + 'sitemapindex' && path[1] === prefix + 'sitemap'))) {
        if (!loc.trim()) invalid = true;
        locs.push(loc.trim());
      }
    }
  }, { xmlMode: true, decodeEntities: true });
  parser.end(xml);
  const kind = root.split(':').pop();
  if (invalid || !['urlset', 'sitemapindex'].includes(kind ?? '') || !xml.includes(`</${root}>`)) {
    throw new Error('Ответ не является корректным sitemap XML');
  }
  return { index: kind === 'sitemapindex', locs };
}
export async function readIndexDocument(url: string, site: string): Promise<string> {
  domainUrl(url, site);
  const document = await readPublicDocument(url, undefined, true);
  domainUrl(document.finalUrl, site);
  let body = document.body;
  if (body[0] === 0x1f && body[1] === 0x8b) body = gunzipSync(body, { maxOutputLength: 4 * 1024 * 1024 });
  return body.toString('utf8');
}
type RegisteredSitemaps = (signal: AbortSignal) => Promise<string[]>;
async function registeredWithDeadline(load: RegisteredSitemaps) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('GSC sitemap timeout')); controller.abort(); }, 10_000);
  });
  try { return await Promise.race([load(controller.signal), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}
export async function collectCheckSitemap(site: string, input = '', read = readIndexDocument, registered?: RegisteredSitemaps) {
  const warnings: string[] = [];
  let sitemaps: string[];
  if (input.trim()) sitemaps = [domainUrl(input, site)];
  else {
    const robots = domainUrl(new URL('/robots.txt', siteHref(site)).href, site);
    const [gscResult, robotsResult] = await Promise.allSettled([
      registered ? registeredWithDeadline(registered) : Promise.resolve([] as string[]),
      read(robots, site)
    ]);
    if (gscResult.status === 'rejected') warnings.push('Не удалось получить список sitemap из GSC; использованы объявления robots.txt.');
    if (robotsResult.status === 'rejected') warnings.push('Не удалось прочитать robots.txt; использованы адреса sitemap из GSC.');
    const gscPaths = gscResult.status === 'fulfilled' ? gscResult.value : [];
    const robotPaths = robotsResult.status === 'fulfilled' ? robotsResult.value.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
      return match ? [new URL(match[1], robots).href] : [];
    }) : [];
    sitemaps = [...new Set([...gscPaths, ...robotPaths].map((path) => domainUrl(path, site)))];
    if (!sitemaps.length) {
      const reason = gscResult.status === 'rejected' || robotsResult.status === 'rejected'
        ? 'Не удалось получить объявления sitemap из доступных источников'
        : 'В GSC и robots.txt не найдены адреса sitemap';
      throw new Error(`${reason}. Укажи Sitemap URL вручную; адрес /sitemap.xml автоматически не подставляется`);
    }
  }
  if (sitemaps.length > 200) throw new Error('Больше 200 карт: укажи отдельный sitemap');
  const pending = [...sitemaps], seen = new Set<string>(), urls = new Set<string>();
  const deadline = Date.now() + 120_000;
  while (pending.length) {
    if (Date.now() > deadline) throw new Error('Загрузка sitemap заняла больше двух минут: укажи дочернюю карту');
    const current = pending.shift()!;
    if (seen.has(current)) continue;
    if (seen.size >= 200) throw new Error('Больше 200 карт: укажи дочерний sitemap');
    seen.add(current);
    const parsed = parseCheckSitemap(await read(current, site));
    for (const loc of parsed.locs) {
      const resolved = domainUrl(new URL(loc, current).href, site);
      if (parsed.index) {
        if (!seen.has(resolved) && !pending.includes(resolved)) pending.push(resolved);
        if (pending.length + seen.size > 200) throw new Error('Больше 200 карт: укажи дочерний sitemap');
      } else urls.add(resolved);
      if (urls.size > INDEX_CHECK_URL_LIMIT) throw new Error(`Больше ${INDEX_CHECK_URL_LIMIT} страниц: укажи отдельную дочернюю карту`);
    }
  }
  if (!urls.size) throw new Error('В sitemap нет URL страниц');
  return { urls: [...urls], sitemaps, warnings };
}
