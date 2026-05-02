import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listSitesWithSummary, fetchPerSiteQueries, fetchPerSitePages, type SiteWithSummary } from '$lib/server/google';

const ALLOWED_DAYS = [3, 7, 28] as const;
type AllowedDays = (typeof ALLOWED_DAYS)[number];

const SORT_FIELDS = ['clicks', 'impressions', 'ctr', 'position', 'site', 'account'] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortDir = 'asc' | 'desc';

function parseDays(raw: string | null): AllowedDays {
  const n = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(n) ? (n as AllowedDays) : 28;
}

function parseSort(raw: string | null): SortField {
  return (SORT_FIELDS as readonly string[]).includes(raw ?? '') ? (raw as SortField) : 'clicks';
}

function parseDir(raw: string | null): SortDir {
  return raw === 'asc' ? 'asc' : 'desc';
}

function compareSites(a: SiteWithSummary, b: SiteWithSummary, field: SortField, dir: SortDir): number {
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

export const load: PageServerLoad = async ({ url }) => {
  const days = parseDays(url.searchParams.get('days'));
  const sort = parseSort(url.searchParams.get('sort'));
  const dir = parseDir(url.searchParams.get('dir'));

  const [sitesResult, queriesResult, pagesResult] = await Promise.all([
    listSitesWithSummary(db(), days),
    fetchPerSiteQueries(db(), days),
    fetchPerSitePages(db(), days)
  ]);

  const sortedSites = [...sitesResult.sites].sort((a, b) => compareSites(a, b, sort, dir));

  // Merge & dedupe errors by accountId across all three calls.
  const errorMap = new Map<string, { accountId: string; accountEmail: string; reason: string }>();
  [...sitesResult.errors, ...queriesResult.errors, ...pagesResult.errors].forEach((e) => {
    if (!errorMap.has(e.accountId)) errorMap.set(e.accountId, e);
  });

  return {
    sites: sortedSites,
    errors: Array.from(errorMap.values()),
    queryEntries: queriesResult.entries,
    pageEntries: pagesResult.entries,
    days,
    sort,
    dir
  };
};

// Никакого кеша. Каждый заход — свежий запрос.
export const prerender = false;
export const ssr = true;
