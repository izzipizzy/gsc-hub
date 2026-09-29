import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listSitesWithSummary, fetchPerSiteQueries, fetchPerSitePages, type SiteWithSummary } from '$lib/server/google';
import { listQueryFilters } from '$lib/server/filters';
import { listIndexNowHosts } from '$lib/server/indexnow';
import { listSiteDates } from '$lib/server/site_dates';
import { siteToHost, getBing } from '$lib/server/bing';
import { requireAdmin } from '$lib/server/guard';

const SORT_FIELDS = ['clicks', 'impressions', 'ctr', 'position', 'site', 'account', 'date'] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortDir = 'asc' | 'desc';

// Any integer day count is accepted, clamped to GSC's 16-month (480-day) window.
function parseDays(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 480);
}

function parseSort(raw: string | null): SortField {
  return (SORT_FIELDS as readonly string[]).includes(raw ?? '') ? (raw as SortField) : 'impressions';
}

function parseDir(raw: string | null): SortDir {
  return raw === 'asc' ? 'asc' : 'desc';
}

type SiteWithMeta = SiteWithSummary & { createdAt: number | null };

function compareSites(a: SiteWithMeta, b: SiteWithMeta, field: SortField, dir: SortDir): number {
  // Sites with no known creation date always go to the bottom.
  if (field === 'date') {
    if (a.createdAt === null && b.createdAt === null) return 0;
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return dir === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
  }
  // Null-summary rows always go to the bottom for numeric fields.
  if (field === 'clicks' || field === 'impressions' || field === 'ctr' || field === 'position') {
    if (a.summary === null && b.summary === null) return 0;
    if (a.summary === null) return 1;
    if (b.summary === null) return -1;
    const av = a.summary[field];
    const bv = b.summary[field];
    return dir === 'asc' ? av - bv : bv - av;
  }
  if (field === 'site') {
    const av = a.siteUrl.toLowerCase();
    const bv = b.siteUrl.toLowerCase();
    if (av === bv) return 0;
    return dir === 'asc' ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
  }
  // account
  const av = (a.accountLabel ?? a.accountEmail).toLowerCase();
  const bv = (b.accountLabel ?? b.accountEmail).toLowerCase();
  if (av === bv) return 0;
  return dir === 'asc' ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
}

export const load: PageServerLoad = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const sort = parseSort(url.searchParams.get('sort'));
  const dir = parseDir(url.searchParams.get('dir'));

  const [sitesResult, queriesResult, pagesResult, bing] = await Promise.all([
    listSitesWithSummary(db(), days),
    fetchPerSiteQueries(db(), days),
    fetchPerSitePages(db(), days),
    getBing()
  ]);

  // Flag sites without an IndexNow key (no {key}.txt → not wired up for Bing/IndexNow),
  // attach recent Bing traffic (best-effort; empty if no BING_API_KEY) and the site's
  // creation date (from the site_dates table, filled by an external import).
  const indexNowHosts = listIndexNowHosts(db());
  const siteDates = listSiteDates(db());
  const enriched = sitesResult.sites.map((s) => {
    const host = siteToHost(s.siteUrl);
    return {
      ...s,
      hasIndexNow: indexNowHosts.has(host),
      bing: bing.traffic.get(host) ?? null,
      createdAt: siteDates.get(host) ?? null
    };
  });
  const sites = enriched.sort((a, b) => compareSites(a, b, sort, dir));

  // Merge & dedupe errors by accountId across all three calls.
  const errorMap = new Map<string, { accountId: string; accountEmail: string; reason: string }>();
  [...sitesResult.errors, ...queriesResult.errors, ...pagesResult.errors].forEach((e) => {
    if (!errorMap.has(e.accountId)) errorMap.set(e.accountId, e);
  });

  return {
    sites,
    errors: Array.from(errorMap.values()),
    queryEntries: queriesResult.entries,
    bingQueries: bing.queries,
    pageEntries: pagesResult.entries,
    queryFilters: listQueryFilters(db()),
    days,
    sort,
    dir
  };
};

// Никакого кеша. Каждый заход — свежий запрос.
export const prerender = false;
export const ssr = true;
