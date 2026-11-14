// Top queries and top pages across the portfolio, summarised on the server.
//
// The /properties page used to receive every site's top 1,000 query rows and
// 200 page rows and aggregate them in the browser: at 10,000 domains that is
// ten million rows on the wire for a table that shows 200. Now the rows stay
// here, one window (`days`) at a time, filled by a background pass like the
// date snapshot, and the browser asks for the slice it shows.
//
// Rows per site come from portfolio-settings: 1,000 query rows on a small
// portfolio, down to 250 at 10,000 domains, unless Settings pins a number.

import type { Db } from './db';
import type { AccountRow } from './accounts';
import { searchAnalyticsQuery, searchAnalyticsUncached, type SiteRow } from './google';
import { completedDayRange } from './gsc-calendar';
import { PortfolioStore, slotKey, type PassInfo, type RefreshStatus, type SiteSlot } from './portfolio-store';
import { topRowsSetting } from './portfolio-settings';
import { queryHidden } from './filters';
import type { BingQuery } from './bing';
import { displaySite, siteDomain } from '$lib/utils/site';

export const TOP_LIMIT = 200;
/** "Show more" stops here: past it the CSV export is the tool. */
export const TOP_MAX_LIMIT = 5_000;

interface QueryRow { query: string; page: string; country: string; clicks: number; impressions: number; position: number }
interface PageRow { page: string; clicks: number; impressions: number; position: number }
export interface SiteTop { queries: QueryRow[]; pages: PageRow[] }

// Limits are read once per pass, not once per site.
const passLimits = new WeakMap<PassInfo, { queries: number; pages: number }>();
function limitsFor(db: Db, pass: PassInfo) {
  let l = passLimits.get(pass);
  if (!l) {
    l = { queries: topRowsSetting(db, 'queries', pass.total).effective, pages: topRowsSetting(db, 'pages', pass.total).effective };
    passLimits.set(pass, l);
  }
  return l;
}

async function fetchTop(db: Db, acc: AccountRow, site: SiteRow, days: number, pass: PassInfo): Promise<SiteTop> {
  const { startDate, endDate } = completedDayRange(days);
  const limits = limitsFor(db, pass);
  const [q, p] = await Promise.all([
    searchAnalyticsUncached(db, acc, site.siteUrl, {
      startDate, endDate, dimensions: ['query', 'page', 'country'], rowLimit: limits.queries
    }),
    searchAnalyticsUncached(db, acc, site.siteUrl, {
      startDate, endDate, dimensions: ['page'], rowLimit: limits.pages
    })
  ]);
  return {
    queries: q.map((r) => ({
      query: r.keys[0] ?? '', page: r.keys[1] ?? '', country: r.keys[2] ?? '',
      clicks: r.clicks, impressions: r.impressions, position: r.position
    })),
    pages: p.map((r) => ({ page: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position }))
  };
}

// One window at a time: a second `days` replaces the first rather than holding both.
let current: { days: number; store: PortfolioStore<SiteTop> } | null = null;

export function topStore(days: number): PortfolioStore<SiteTop> {
  if (!current || current.days !== days) {
    current?.store.reset();
    current = { days, store: new PortfolioStore<SiteTop>((db, acc, site, pass) => fetchTop(db, acc, site, days, pass)) };
  }
  return current.store;
}

export function invalidateTop(): void {
  current?.store.invalidate();
}

/** Pages of one site, for the inspection panel: from the store when it has them. */
export async function sitePages(db: Db, acc: AccountRow, siteUrl: string, days: number): Promise<PageRow[]> {
  if (current?.days === days) {
    const view = await current.store.get(db, { wait: false });
    const slot = view.slots.find((s) => s.site.accountId === acc.id && s.site.siteUrl === siteUrl);
    if (slot?.value) return slot.value.pages;
  }
  const { startDate, endDate } = completedDayRange(days);
  const rows = await searchAnalyticsQuery(db, acc, siteUrl, {
    startDate, endDate, dimensions: ['page'], rowLimit: topRowsSetting(db, 'pages', 1).effective
  });
  return rows.map((r) => ({ page: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions, position: r.position }));
}

// ─── Aggregation: the logic that lived in properties/+page.svelte ───

export type QuerySort = 'query' | 'page' | 'country' | 'clicks' | 'impressions' | 'ctr' | 'position' | 'bingClicks' | 'bingImpr';
export type PageSort = 'page' | 'clicks' | 'impressions' | 'ctr' | 'position';
export type QuerySource = 'all' | 'gsc' | 'bing' | 'both';

export interface TopQueryRow {
  query: string;
  page: string;
  country: string;
  domain: string;
  gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
  bing: { clicks: number; impressions: number; position: number } | null;
}

export interface QueryParams {
  sort: QuerySort;
  dir: 'asc' | 'desc';
  countries: Set<string>;
  domains: Set<string>;
  source: QuerySource;
  posMin: number | null;
  posMax: number | null;
  showFiltered: boolean;
  patterns: string[];
}

const norm = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim();

/** GSC rows of visible sites merged by query × page × country, plus Bing-only keys. */
export function allQueries(slots: SiteSlot<SiteTop>[], hidden: Set<string>, bingQueries: BingQuery[]): TopQueryRow[] {
  // Bing data is merged only for visible domains, so hidden sites don't leak back in via Bing.
  const visibleDomains = new Set<string>();
  for (const s of slots) if (!hidden.has(slotKey(s.site.accountId, s.site.siteUrl))) visibleDomains.add(siteDomain(s.site.siteUrl));
  const bingByDomain = new Map<string, Map<string, { query: string; clicks: number; impressions: number; position: number }>>();
  for (const b of bingQueries) {
    if (!visibleDomains.has(b.host)) continue;
    let m = bingByDomain.get(b.host);
    if (!m) bingByDomain.set(b.host, (m = new Map()));
    m.set(norm(b.query), { query: b.query, clicks: b.clicks, impressions: b.impressions, position: b.position });
  }

  type Bucket = { query: string; page: string; country: string; domain: string; host: string; clicks: number; impressions: number; posSum: number; posWeight: number };
  const map = new Map<string, Bucket>();
  const gscCovered = new Set<string>();
  for (const s of slots) {
    if (!s.value || hidden.has(slotKey(s.site.accountId, s.site.siteUrl))) continue;
    const domain = displaySite(s.site.siteUrl);
    const host = siteDomain(s.site.siteUrl);
    for (const r of s.value.queries) {
      if (!r.query) continue;
      const key = `${r.query}|${r.page}|${r.country}`;
      let cur = map.get(key);
      if (!cur) map.set(key, (cur = { query: r.query, page: r.page, country: r.country, domain, host, clicks: 0, impressions: 0, posSum: 0, posWeight: 0 }));
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.posSum += r.position * r.impressions;
      cur.posWeight += r.impressions;
      gscCovered.add(`${host}\n${norm(r.query)}`);
    }
  }
  const out: TopQueryRow[] = [];
  for (const b of map.values()) {
    const bq = bingByDomain.get(b.host)?.get(norm(b.query));
    out.push({
      query: b.query, page: b.page, country: b.country, domain: b.domain,
      gsc: {
        clicks: b.clicks,
        impressions: b.impressions,
        ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
        position: b.posWeight > 0 ? b.posSum / b.posWeight : 0
      },
      bing: bq ? { clicks: bq.clicks, impressions: bq.impressions, position: bq.position } : null
    });
  }
  // Bing-only keys (no GSC row for that domain) → rows showing the domain, no page URL.
  for (const [host, m] of bingByDomain) {
    for (const [nq, v] of m) {
      if (gscCovered.has(`${host}\n${nq}`)) continue;
      out.push({ query: v.query, page: '', country: '', domain: host, gsc: null, bing: { clicks: v.clicks, impressions: v.impressions, position: v.position } });
    }
  }
  return out;
}

function queryComparator(sort: QuerySort, dir: 'asc' | 'desc') {
  const mul = dir === 'desc' ? -1 : 1;
  const val = (q: TopQueryRow) => {
    switch (sort) {
      case 'clicks': return q.gsc?.clicks ?? -1;
      case 'impressions': return q.gsc?.impressions ?? -1;
      case 'ctr': return q.gsc?.ctr ?? -1;
      case 'position': return q.gsc?.position ?? q.bing?.position ?? 99999;
      case 'bingClicks': return q.bing?.clicks ?? -1;
      case 'bingImpr': return q.bing?.impressions ?? -1;
      default: return 0;
    }
  };
  return (a: TopQueryRow, b: TopQueryRow): number => {
    let c: number;
    if (sort === 'query') c = a.query.localeCompare(b.query);
    else if (sort === 'page') c = a.page.localeCompare(b.page);
    else if (sort === 'country') c = a.country.localeCompare(b.country);
    else c = val(a) - val(b);
    if (c !== 0) return mul * c;
    // Fixed tie-break: the same request always yields the same 200 rows.
    return a.query.localeCompare(b.query) || a.page.localeCompare(b.page) || a.country.localeCompare(b.country) || a.domain.localeCompare(b.domain);
  };
}

/**
 * The first `limit` items of `items` under `cmp`, without sorting everything:
 * a bounded insertion list, O(n · limit) worst case but O(n) for most data.
 */
export function topK<T>(items: Iterable<T>, cmp: (a: T, b: T) => number, limit: number): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (out.length === limit && cmp(it, out[limit - 1]) >= 0) continue;
    let lo = 0, hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(out[mid], it) <= 0) lo = mid + 1;
      else hi = mid;
    }
    out.splice(lo, 0, it);
    if (out.length > limit) out.pop();
  }
  return out;
}

export interface TopQueriesResult {
  rows: TopQueryRow[];
  /** All GSC rows of visible sites, before any filter — the "of N" in the header. */
  sourceRows: number;
  /** Rows the filter list hides (0 while they are shown). */
  filteredCount: number;
  /** Rows passing every filter — `rows` is the first `limit` of them. */
  matched: number;
  availableCountries: string[];
  availableDomains: string[];
}

export function topQueries(all: TopQueryRow[], sourceRows: number, p: QueryParams, limit = TOP_LIMIT): TopQueriesResult {
  const isFiltered = (q: string) => queryHidden(q, p.patterns);
  const countries = new Set<string>();
  const domains = new Set<string>();
  let filteredCount = 0;
  let matched = 0;
  const hasMin = p.posMin != null && p.posMin > 0;
  const hasMax = p.posMax != null;
  function* pass() {
    for (const q of all) {
      if (q.country) countries.add(q.country);
      if (q.domain) domains.add(q.domain);
      if (isFiltered(q.query)) {
        if (!p.showFiltered) { filteredCount++; continue; }
      }
      if (p.countries.size > 0 && !p.countries.has(q.country)) continue;
      if (p.domains.size > 0 && !p.domains.has(q.domain)) continue;
      if (p.source === 'gsc' && !(q.gsc && !q.bing)) continue;
      if (p.source === 'bing' && !(q.bing && !q.gsc)) continue;
      if (p.source === 'both' && !(q.gsc && q.bing)) continue;
      if (hasMin || hasMax) {
        const pos = q.gsc?.position ?? q.bing?.position ?? 0;
        if (pos <= 0) continue;
        if (hasMin && pos < (p.posMin as number)) continue;
        if (hasMax && pos > (p.posMax as number)) continue;
      }
      matched++;
      yield q;
    }
  }
  const rows = topK(pass(), queryComparator(p.sort, p.dir), clampLimit(limit));
  return {
    rows,
    sourceRows,
    filteredCount,
    matched,
    availableCountries: [...countries].sort(),
    availableDomains: [...domains].sort()
  };
}

export function clampLimit(limit: number): number {
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, TOP_MAX_LIMIT) : TOP_LIMIT;
}

export interface TopPageRow { page: string; clicks: number; impressions: number; ctr: number; position: number }

export function topPages(slots: SiteSlot<SiteTop>[], hidden: Set<string>, sort: PageSort, dir: 'asc' | 'desc', limit = TOP_LIMIT): { rows: TopPageRow[]; sourceRows: number; matched: number } {
  const map = new Map<string, { clicks: number; impressions: number; posSum: number; posWeight: number }>();
  let sourceRows = 0;
  for (const s of slots) {
    if (!s.value || hidden.has(slotKey(s.site.accountId, s.site.siteUrl))) continue;
    sourceRows += s.value.pages.length;
    for (const r of s.value.pages) {
      if (!r.page) continue;
      let cur = map.get(r.page);
      if (!cur) map.set(r.page, (cur = { clicks: 0, impressions: 0, posSum: 0, posWeight: 0 }));
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.posSum += r.position * r.impressions;
      cur.posWeight += r.impressions;
    }
  }
  const mul = dir === 'desc' ? -1 : 1;
  function* rows() {
    for (const [page, b] of map) {
      yield {
        page,
        clicks: b.clicks,
        impressions: b.impressions,
        ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
        position: b.posWeight > 0 ? b.posSum / b.posWeight : 0
      };
    }
  }
  const cmp = (a: TopPageRow, b: TopPageRow) => {
    const c = sort === 'page' ? a.page.localeCompare(b.page) : a[sort] - b[sort];
    return c !== 0 ? mul * c : a.page.localeCompare(b.page);
  };
  return { rows: topK(rows(), cmp, clampLimit(limit)), sourceRows, matched: map.size };
}

export function gscRowCount(slots: SiteSlot<SiteTop>[], hidden: Set<string>): number {
  let n = 0;
  for (const s of slots) if (s.value && !hidden.has(slotKey(s.site.accountId, s.site.siteUrl))) n += s.value.queries.length;
  return n;
}

export type { RefreshStatus };
