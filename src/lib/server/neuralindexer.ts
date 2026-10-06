import pkg from '../../../package.json';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Parser } from 'htmlparser2';
import type { Db } from './db';
import { getConfigValue } from './config';
import { readPublicDocument } from './backlink-fetch';
import { siteHostname, customPurchaseUrl } from '$lib/utils/url-filters';

export type IndexQueue = 'slow' | 'fast' | 'yandex';
const BASE = 'https://inderixingbot.com/api/';
const LIMIT = 50_000;
export function indexToken(database: Db): string {
  const token = getConfigValue(database, 'NEURALINDEXER_API_TOKEN');
  if (!token) throw new Error('Укажи API-ключ NeuralIndexer в разделе «Индексаторы»');
  return token;
}
function fingerprint(token: string) { return createHash('sha256').update(token).digest('hex'); }
export async function indexApi(token: string, path: string, body?: unknown): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `Mozilla/5.0 GSC-Hub/${pkg.version}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: 'error' });
  } catch { throw new Error('NeuralIndexer не ответил. Повтор отправки использует тот же ID и не создаёт повторное списание'); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status === 'error') {
    const reason = String(data?.error_code ?? data?.error ?? `HTTP ${res.status}`).replaceAll(token, '[скрыто]').slice(0, 180);
    throw new Error(`NeuralIndexer: ${reason}`);
  }
  return data;
}
export async function indexBalance(database: Db, _force = false) {
  const token = indexToken(database);
  // Called only for explicit calculations/access tests, never on page loads.
  const data = await indexApi(token, 'balance.php', { api_key: token });
  const balance = Number(data.balance_usd ?? data.balance);
  if (!Number.isFinite(balance) || balance < 0) throw new Error('Сервис не вернул корректный баланс');
  return { balance_usd: balance, price_per_link: data.price_per_link,
    price_per_link_fast: data.price_per_link_fast, price_per_link_yandex: data.price_per_link_yandex };
}
export function domainUrl(raw: string, site: string): string {
  const value = raw.trim();
  const u = new URL(value.startsWith('/') ? customPurchaseUrl(value, site) : value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port || siteHostname(u.href) !== siteHostname(site)) {
    throw new Error('Все URL должны принадлежать текущему домену и использовать HTTP(S) без логина и порта');
  }
  if (u.href.length > 2000) throw new Error('URL длиннее 2000 символов');
  u.hash = '';
  return u.href;
}
export function pageUrls(raw: string, site: string): string[] {
  const urls = [...new Set(raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => domainUrl(s, site)))];
  if (!urls.length) throw new Error('Укажи хотя бы один URL');
  if (urls.length > LIMIT) throw new Error(`Максимум ${LIMIT} URL за отправку`);
  return urls;
}
export function parseIndexSitemap(xml: string) {
  let root = ''; let inLoc = false; let current = ''; const locs: string[] = [];
  const parser = new Parser({ onopentag(name) {
    if (!root) root = name;
    if (name === 'loc') { inLoc = true; current = ''; }
  }, ontext(text) { if (inLoc) current += text; }, onclosetag(name) {
    if (name === 'loc' && inLoc) { locs.push(current.trim()); inLoc = false; }
  } }, { xmlMode: true, decodeEntities: true });
  parser.write(xml); parser.end();
  if (!['urlset', 'sitemapindex'].includes(root) || !xml.includes(`</${root}>`)) throw new Error('Ответ не является XML-картой сайта');
  return { index: root === 'sitemapindex', locs };
}
export async function indexSitemapUrls(raw: string, site: string,
  read: (url: string) => Promise<string> = async url => {
    const page = await readPublicDocument(url, undefined, true);
    domainUrl(page.finalUrl, site);
    let body = page.body;
    if (body[0] === 0x1f && body[1] === 0x8b) body = gunzipSync(body, { maxOutputLength: 4 * 1024 * 1024 });
    return body.toString('utf8');
  }): Promise<string[]> {
  const pending = [domainUrl(raw, site)], seen = new Set<string>(), pages = new Set<string>();
  const deadline = Date.now() + 120_000;
  while (pending.length) {
    if (Date.now() > deadline) throw new Error('Карта слишком большая: выбери отдельную дочернюю карту');
    const url = pending.shift()!;
    if (seen.has(url)) continue;
    if (seen.size >= 200) throw new Error('Больше 200 дочерних карт: выбери отдельную карту');
    seen.add(url);
    const parsed = parseIndexSitemap(await read(url));
    for (const loc of parsed.locs) {
      const resolved = domainUrl(new URL(loc, url).href, site);
      if (parsed.index) { if (pending.length >= 200) throw new Error('Слишком много дочерних карт'); pending.push(resolved); }
      else pages.add(resolved);
      if (pages.size > LIMIT) throw new Error(`Больше ${LIMIT} URL: выбери отдельную дочернюю карту`);
    }
  }
  if (!pages.size) throw new Error('В карте нет URL страниц');
  return [...pages];
}
export function priceForQueue(balance: Record<string, any>, queue: IndexQueue): number {
  const raw = queue === 'fast' ? (balance.price_per_link_fast ?? 0.50) : queue === 'yandex' ? (balance.price_per_link_yandex ?? balance.price_per_link) : balance.price_per_link;
  const price = Number(raw ?? 0.0122);
  if (!Number.isFinite(price) || price < 0) throw new Error('Сервис вернул некорректную цену');
  return price;
}
export async function createIndexQuote(database: Db, site: string, urls: string[], queue: IndexQueue) {
  const token = indexToken(database);
  const balance = await indexBalance(database, true);
  const price = priceForQueue(balance, queue), id = randomUUID(), now = Date.now();
  database.prepare('INSERT INTO indexing_requests(id,site,token_hash,queue,urls,price,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, site, fingerprint(token), queue, JSON.stringify(urls), price, now, now);
  return { id, count: urls.length, price, total: Math.round(price * urls.length * 1e6) / 1e6,
    balance: balance.balance_usd, urls, queue, expiresAt: now + 30 * 60_000 };
}
export async function submitIndexQuote(database: Db, site: string, id: string) {
  const row = database.prepare('SELECT * FROM indexing_requests WHERE id=? AND site=?').get(id, site) as any;
  if (!row) throw new Error('Расчёт не найден');
  const token = indexToken(database);
  if (row.token_hash !== fingerprint(token)) throw new Error('Ключ изменился: пересчитай стоимость');
  if (row.status === 'submitted') return JSON.parse(row.result);
  if (row.status === 'sending') throw new Error('Отправка уже выполняется. Обнови историю через минуту');
  if (row.status === 'quoted' && Date.now() - row.created_at > 30 * 60_000) throw new Error('Расчёт устарел: пересчитай стоимость');
  const claimed = database.prepare("UPDATE indexing_requests SET status='sending',updated_at=? WHERE id=? AND status IN ('quoted','uncertain')").run(Date.now(), id);
  if (!claimed.changes) throw new Error('Отправка уже выполняется');
  try {
    const result = await indexApi(token, 'v2/submissions', { links: JSON.parse(row.urls), queue: row.queue, client_batch_id: id, external_id: id, label: site.slice(0,255) });
    if (result.submission_id === undefined) throw new Error('Сервис не вернул ID отправки');
    const saved = { submissionId: result.submission_id, accepted: result.total_links_accepted ?? null, charged: result.charged_amount ?? null, balance: result.balance_usd ?? null };
    database.prepare("UPDATE indexing_requests SET status='submitted',result=?,updated_at=? WHERE id=?").run(JSON.stringify(saved), Date.now(), id);
    return saved;
  } catch(e) {
    database.prepare("UPDATE indexing_requests SET status='uncertain',result=?,updated_at=? WHERE id=?").run(JSON.stringify({ error: (e as Error).message }), Date.now(), id);
    throw e;
  }
}
export function indexHistory(database: Db, site: string) {
  // A process interrupted during a send may safely retry with the same provider idempotency key.
  database.prepare("UPDATE indexing_requests SET status='uncertain' WHERE site=? AND status='sending' AND updated_at<?").run(site, Date.now()-60_000);
  return (database.prepare("SELECT id,queue,urls,price,created_at,status,result FROM indexing_requests WHERE site=? AND status!='quoted' ORDER BY created_at DESC LIMIT 30").all(site) as any[])
    .map(r => ({ id: r.id, queue: r.queue, count: JSON.parse(r.urls).length, createdAt: r.created_at, status: r.status, result: r.result ? JSON.parse(r.result) : null }));
}
