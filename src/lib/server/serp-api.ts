import { error } from '@sveltejs/kit';
import type { Db } from './db';
import type { DimensionFilterGroup, SearchAnalyticsRow, SiteRow } from './google';
import { listSitesForAllAccounts, searchAnalyticsPages, searchAnalyticsQuery } from './google';
import { mapSettledLimit, DEFAULT_LIMIT } from './concurrency';
import { completedDayRange } from './gsc-calendar';
import { listAccounts } from './accounts';
import type { AccountRow } from './accounts';
import { listHiddenSites } from './hidden';
import { alpha2ToAlpha3, alpha3ToAlpha2 } from '$lib/utils/country';

export interface SiteOut {
  site: string;
  source: 'gsc' | 'bing';
  account: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SitesPayload {
  sites: SiteOut[];
  partial: { account: string; reason: string }[];
  period_start: string;
  period_end: string;
  fetched_at: string;
  country_supported: boolean;
}

export interface SitesQuery {
  country: string;
  days: number;
  // Только 'gsc': список сайтов Bing строится в bing.ts своим путём — у него
  // другой API и другой список сайтов.
  source: 'gsc';
}

export interface SiteTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryOut {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueriesPayload {
  rows: QueryOut[];
  period_start: string;
  period_end: string;
  fetched_at: string;
  data_state: 'all' | 'final';
  truncated: boolean;
  max_rows: number;
  source: 'gsc' | 'bing';
  account: string;
  country_supported: boolean;
}

/**
 * Ключ кэша: страна, период и источник входят обязательно — общий кэш иначе
 * начнёт отдавать цифры чужого диапазона на втором же запросе.
 */
export function cacheKey(q: SitesQuery): string {
  return `${q.country}|${q.days}|${q.source}`;
}

/**
 * Убрать сайты, скрытые в хабе.
 *
 * Скрытие живёт в БД парой `accountId|siteUrl` — ровно так же прячет их
 * собственная панель хаба. Человек уже сказал, что не хочет видеть этот
 * сайт; предлагать его к импорту значит не услышать.
 */
export function excludeHidden(sites: SiteRow[], hidden: Set<string>): SiteRow[] {
  if (!hidden.size) return sites;
  return sites.filter((s) => !hidden.has(`${s.accountId}|${s.siteUrl}`));
}

/** Фильтр страны для Search Analytics. GSC хранит страну в alpha-3. */
export function countryFilterGroups(country: string): DimensionFilterGroup[] | undefined {
  const alpha3 = alpha2ToAlpha3(country);
  if (!alpha3) return undefined;
  return [{ filters: [{ dimension: 'country', operator: 'equals', expression: alpha3 }] }];
}

export function toSitesPayload(
  measured: { site: SiteRow; totals: SiteTotals | null }[],
  errors: { accountId: string; accountEmail: string; reason: string }[],
  window: { start: string; end: string; fetchedAt: string; source: 'gsc' | 'bing' }
): SitesPayload {
  // Один property, доступный из двух аккаунтов, — это ОДИН сайт с одними и
  // теми же цифрами: данные property от аккаунта не зависят. Две строки
  // потребитель сложил бы в «Итого» и задвоил показы, поэтому оставляем
  // первую в стабильном порядке.
  const seen = new Set<string>();
  const sites: SiteOut[] = [];
  for (const m of measured) {
    // Сайт без показов в этой стране в ответ не попадает: экран импорта
    // спрашивает «где у нас есть трафик в ES», и пустая строка там — шум.
    if (!m.totals || m.totals.impressions <= 0) continue;
    if (seen.has(m.site.siteUrl)) continue;
    seen.add(m.site.siteUrl);
    sites.push({
      site: m.site.siteUrl,
      source: window.source,
      account: m.site.accountEmail,
      clicks: m.totals.clicks,
      impressions: m.totals.impressions,
      ctr: m.totals.ctr,
      position: m.totals.position
    });
  }
  return {
    sites,
    partial: errors.map((e) => ({ account: e.accountEmail, reason: e.reason })),
    period_start: window.start,
    period_end: window.end,
    fetched_at: window.fetchedAt,
    country_supported: window.source === 'gsc'
  };
}

// Веер по сайтам — известная цена: столько же вызовов Google делает страница
// Sites. Но ручки дёргают с экрана импорта, и повторять веер на каждый клик
// незачем — отсюда кэши ниже, в ключах которых обязательно есть период.
const TTL_MS = 10 * 60 * 1000;

export interface CountryOut {
  country: string;      // alpha-2, как его принимает серпмонитор
  sites: number;
  clicks: number;
  impressions: number;
}

export interface CountriesPayload {
  countries: CountryOut[];
  period_start: string;
  period_end: string;
  fetched_at: string;
  partial: { account: string; reason: string }[];
}

/**
 * Строки по стране со всех сайтов → список гео, в которых реально есть
 * показы.
 *
 * Нужен затем, чтобы на экране импорта не вводить страну вслепую: гео,
 * которого нет ни у одного сайта, предлагать бессмысленно. `zzz` GSC ставит
 * там, где страну не определил, — такой «рынок» отбрасываем.
 */
export function toCountriesPayload(
  measured: { site: SiteRow; rows: SearchAnalyticsRow[] }[],
  window: { start: string; end: string },
  errors: { accountEmail: string; reason: string }[] = []
): CountriesPayload {
  const agg = new Map<string, { sites: Set<string>; clicks: number; impressions: number }>();
  for (const m of measured) {
    for (const r of m.rows ?? []) {
      const alpha2 = alpha3ToAlpha2(r.keys?.[0] ?? '');
      if (!alpha2) continue;
      const cur = agg.get(alpha2) ?? { sites: new Set<string>(), clicks: 0, impressions: 0 };
      cur.sites.add(m.site.siteUrl);
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      agg.set(alpha2, cur);
    }
  }
  return {
    countries: [...agg.entries()]
      .map(([country, a]) => ({
        country,
        sites: a.sites.size,
        clicks: a.clicks,
        impressions: a.impressions
      }))
      .sort((x, y) => y.impressions - x.impressions),
    period_start: window.start,
    period_end: window.end,
    fetched_at: new Date().toISOString(),
    partial: errors.map((e) => ({ account: e.accountEmail, reason: e.reason }))
  };
}

const countriesCache = new Map<string, { at: number; payload: CountriesPayload }>();

export async function countriesByPeriod(db: Db, days: number): Promise<CountriesPayload> {
  const key = `countries|${days}`;
  const hit = countriesCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;

  const { startDate, endDate } = completedDayRange(days);
  const fanOut = await listSitesForAllAccounts(db);
  // Скрытые сайты не должны попадать и в счётчики гео: иначе гео с одними
  // скрытыми сайтами предлагалось бы к импорту, а таблица приезжала пустой.
  const visible = excludeHidden(fanOut.sites, new Set(listHiddenSites(db)));
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));
  const settled = await mapSettledLimit(
    visible,
    (site: SiteRow) => {
      const acc = accounts.get(site.accountId);
      if (!acc) return Promise.resolve([] as SearchAnalyticsRow[]);
      return searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate,
        endDate,
        dimensions: ['country'],
        rowLimit: 500
      });
    },
    DEFAULT_LIMIT
  );

  const errors = fanOut.errors.map((e) => ({ accountEmail: e.accountEmail, reason: e.reason }));
  const measured = visible.map((site, i) => {
    const outcome = settled[i];
    if (outcome.status === 'rejected') {
      errors.push({ accountEmail: site.accountEmail, reason: String((outcome.reason as Error).message) });
      return { site, rows: [] as SearchAnalyticsRow[] };
    }
    return { site, rows: outcome.value };
  });

  const payload = toCountriesPayload(measured, { start: startDate, end: endDate }, errors);
  countriesCache.set(key, { at: Date.now(), payload });
  return payload;
}

const cache = new Map<string, { at: number; payload: SitesPayload }>();

export async function sitesByCountry(db: Db, q: SitesQuery): Promise<SitesPayload> {
  const key = cacheKey(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;

  const { startDate, endDate } = completedDayRange(q.days);
  const fanOut = await listSitesForAllAccounts(db);
  const visible = excludeHidden(fanOut.sites, new Set(listHiddenSites(db)));
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));

  // Один запрос totals на сайт: dimensions: [] отдаёт единственную строку с
  // суммами, а фильтр страны — ровно тот разрез, ради которого всё
  // затевалось. listSitesWithSummary тут не подходит: он считает итоги без
  // разреза по странам.
  const settled = await mapSettledLimit(
    visible,
    (site: SiteRow) => {
      const acc = accounts.get(site.accountId);
      if (!acc) return Promise.resolve([] as SearchAnalyticsRow[]);
      return searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate,
        endDate,
        dimensions: [],
        dimensionFilterGroups: countryFilterGroups(q.country),
        rowLimit: 1
      });
    },
    DEFAULT_LIMIT
  );

  const errors = [...fanOut.errors];
  const measured = visible.map((site, i) => {
    const outcome = settled[i];
    if (outcome.status === 'rejected') {
      errors.push({
        accountId: site.accountId,
        accountEmail: site.accountEmail,
        reason: String((outcome.reason as Error).message)
      });
      return { site, totals: null };
    }
    const row = outcome.value[0];
    return {
      site,
      totals: row
        ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
        : null
    };
  });

  const payload = toSitesPayload(measured, errors, {
    start: startDate,
    end: endDate,
    fetchedAt: new Date().toISOString(),
    source: q.source
  });
  cache.set(key, { at: Date.now(), payload });
  return payload;
}


/**
 * Аккаунт для запросов по property. Выбирается детерминированно: первый
 * активный с доступом к этому property, в порядке добавления. Данные property
 * одинаковы у любого аккаунта с доступом, но «какой попался» давал бы разные
 * квоты от запроса к запросу. `id` — строка, поэтому сортируем по времени
 * добавления.
 *
 * Скрытые в хабе сайты здесь НЕ отсеиваются: скрытие — про шум в списке, а
 * тот, кто назвал property явно, знает, что просит.
 */
async function pickAccount(db: Db, site: string): Promise<AccountRow> {
  const owning = new Set(
    (await listSitesForAllAccounts(db)).sites
      .filter((s) => s.siteUrl === site)
      .map((s) => s.accountId)
  );
  const account = listAccounts(db)
    .filter((a) => a.status === 'active' && owning.has(a.id))
    .sort((a, b) => a.added_at - b.added_at || a.id.localeCompare(b.id))[0];
  if (!account) throw error(409, 'no active google account for this site');
  return account;
}

export interface PropertyOut {
  site: string;
  account: string;
  hidden: boolean;
}

export interface PropertiesPayload {
  sites: PropertyOut[];
  partial: { account: string; reason: string }[];
}

/**
 * Все property со всех аккаунтов — включая скрытые, с флагом.
 *
 * Экран «один сайт → несколько гео» выбирает сайт руками, и скрытый там
 * должен быть доступен: человек спрятал его из панели, а не запретил с ним
 * работать. Property, доступный из двух аккаунтов, — одна строка; скрытым
 * он считается, только если спрятан в каждой паре: иначе мы врали бы про
 * аккаунт, где он на виду.
 */
export function toPropertiesPayload(
  sites: SiteRow[],
  hidden: Set<string>,
  errors: { accountId: string; accountEmail: string; reason: string }[]
): PropertiesPayload {
  const byUrl = new Map<string, { account: string; hidden: boolean }>();
  for (const s of sites) {
    const isHidden = hidden.has(`${s.accountId}|${s.siteUrl}`);
    const cur = byUrl.get(s.siteUrl);
    if (!cur) byUrl.set(s.siteUrl, { account: s.accountEmail, hidden: isHidden });
    else cur.hidden = cur.hidden && isHidden;
  }
  return {
    sites: [...byUrl.entries()]
      .map(([site, v]) => ({ site, account: v.account, hidden: v.hidden }))
      .sort((a, b) => a.site.localeCompare(b.site)),
    partial: errors.map((e) => ({ account: e.accountEmail, reason: e.reason }))
  };
}

export async function propertiesForImport(db: Db): Promise<PropertiesPayload> {
  // Без веера в Search Analytics: один sites.list на аккаунт — та же цена,
  // что у любой страницы хаба. Кэш поэтому не нужен.
  const fanOut = await listSitesForAllAccounts(db);
  return toPropertiesPayload(fanOut.sites, new Set(listHiddenSites(db)), fanOut.errors);
}

export interface SiteCountryOut {
  country: string;      // alpha-2, как его принимает серпмонитор
  clicks: number;
  impressions: number;
  position: number;
}

export interface SiteCountriesPayload {
  countries: SiteCountryOut[];
  period_start: string;
  period_end: string;
  fetched_at: string;
  account: string;
}

/**
 * Строки одного сайта по стране → гео, в которых у него есть показы, по
 * объёму. `zzz` — «страна не определена», такого рынка нет.
 */
export function toSiteCountriesPayload(
  rows: SearchAnalyticsRow[],
  window: { start: string; end: string; account: string }
): SiteCountriesPayload {
  const countries: SiteCountryOut[] = [];
  for (const r of rows ?? []) {
    const alpha2 = alpha3ToAlpha2(r.keys?.[0] ?? '');
    if (!alpha2 || r.impressions <= 0) continue;
    countries.push({
      country: alpha2, clicks: r.clicks, impressions: r.impressions, position: r.position
    });
  }
  countries.sort((x, y) => y.impressions - x.impressions);
  return {
    countries,
    period_start: window.start,
    period_end: window.end,
    fetched_at: new Date().toISOString(),
    account: window.account
  };
}

export async function siteCountries(
  db: Db,
  q: { site: string; days: number }
): Promise<SiteCountriesPayload> {
  const { startDate, endDate } = completedDayRange(q.days);
  const account = await pickAccount(db, q.site);
  // Один вызов на сайт: разрез по стране, 500 строк — стран меньше.
  const rows = await searchAnalyticsQuery(db, account, q.site, {
    startDate,
    endDate,
    dimensions: ['country'],
    rowLimit: 500
  });
  return toSiteCountriesPayload(rows, { start: startDate, end: endDate, account: account.email });
}

/**
 * Строки Search Analytics → ответ ручки. Отдельно от похода в сеть, чтобы
 * форма ответа проверялась без Google.
 */
export function toQueriesPayload(
  rows: SearchAnalyticsRow[],
  window: { start: string; end: string; truncated: boolean; maxRows: number; account: string }
): QueriesPayload {
  return {
    rows: rows.map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position
    })),
    period_start: window.start,
    period_end: window.end,
    fetched_at: new Date().toISOString(),
    data_state: 'all',
    truncated: window.truncated,
    max_rows: window.maxRows,
    source: 'gsc',
    account: window.account,
    country_supported: true
  };
}

export async function queriesForSite(
  db: Db,
  q: { site: string; country: string; days: number }
): Promise<QueriesPayload> {
  const { startDate, endDate } = completedDayRange(q.days);
  const account = await pickAccount(db, q.site);

  // Возвращает AsyncIterable с полями truncated и maxRows (google.ts:244).
  const pages = searchAnalyticsPages(db, account, q.site, {
    startDate,
    endDate,
    dimensions: ['query'],
    dimensionFilterGroups: countryFilterGroups(q.country),
    dataState: 'all'
  });

  const collected: SearchAnalyticsRow[] = [];
  for await (const page of pages) collected.push(...page);

  return toQueriesPayload(collected, {
    start: startDate,
    end: endDate,
    truncated: pages.truncated,
    maxRows: pages.maxRows,
    account: account.email
  });
}

export interface QueryPageOut {
  query: string;
  page: string;        // страница с наибольшими показами по запросу
  clicks: number;
  impressions: number;
  pages: number;       // сколько разных страниц собирали показы по запросу
}

export interface QueryPagesPayload {
  rows: QueryPageOut[];
  period_start: string;
  period_end: string;
  fetched_at: string;
  truncated: boolean;
  max_rows: number;
  account: string;
}

/**
 * Строки (запрос, страница) → по одной строке на запрос с его главной
 * посадочной страницей. Нужно серпмонитору, чтобы отсеивать ключи, которые
 * приземляются на новости и блог: у не найденного в выдаче ключа URL позиции
 * нет, и по нему такой ключ не отличить.
 */
export function toQueryPagesPayload(
  rows: SearchAnalyticsRow[],
  window: { start: string; end: string; truncated: boolean; maxRows: number; account: string }
): QueryPagesPayload {
  const best = new Map<string, QueryPageOut>();
  for (const r of rows) {
    const query = r.keys?.[0] ?? '';
    const page = r.keys?.[1] ?? '';
    if (!query || !page) continue;
    const cur = best.get(query);
    if (!cur) {
      best.set(query, { query, page, clicks: r.clicks, impressions: r.impressions, pages: 1 });
      continue;
    }
    cur.pages += 1;
    if (r.impressions > cur.impressions) {
      cur.page = page;
      cur.clicks = r.clicks;
      cur.impressions = r.impressions;
    }
  }
  return {
    rows: [...best.values()],
    period_start: window.start,
    period_end: window.end,
    fetched_at: new Date().toISOString(),
    truncated: window.truncated,
    max_rows: window.maxRows,
    account: window.account
  };
}

export async function queryPagesForSite(
  db: Db,
  q: { site: string; country: string; days: number }
): Promise<QueryPagesPayload> {
  const { startDate, endDate } = completedDayRange(q.days);
  const account = await pickAccount(db, q.site);
  const pages = searchAnalyticsPages(db, account, q.site, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    dimensionFilterGroups: countryFilterGroups(q.country),
    dataState: 'all'
  });
  const collected: SearchAnalyticsRow[] = [];
  for await (const page of pages) collected.push(...page);
  return toQueryPagesPayload(collected, {
    start: startDate,
    end: endDate,
    truncated: pages.truncated,
    maxRows: pages.maxRows,
    account: account.email
  });
}
