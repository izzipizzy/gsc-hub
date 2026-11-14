import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { portfolio, summaryOf, type SummaryOf } from '$lib/server/portfolio';
import type { SiteRow } from '$lib/server/google';
import { listQueryFilters } from '$lib/server/filters';
import { listIndexNowHosts } from '$lib/server/indexnow';
import { listSiteDates } from '$lib/server/site_dates';
import { listHiddenSites } from '$lib/server/hidden';
import { siteToHost, getBingWithin } from '$lib/server/bing';
import { requireAdmin } from '$lib/server/guard';
import { matchesSiteDomain } from '$lib/utils/site';
import { paginate, parsePage } from '$lib/utils/paging';

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

type SiteWithMeta = SiteRow & SummaryOf & { createdAt: number | null };

function compareField(a: SiteWithMeta, b: SiteWithMeta, field: SortField, dir: SortDir): number {
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

function compareSites(a: SiteWithMeta, b: SiteWithMeta, field: SortField, dir: SortDir): number {
  // Equal on the chosen field falls through to the full key, so the order —
  // and every page boundary — is the same on each load.
  return compareField(a, b, field, dir) || a.siteUrl.localeCompare(b.siteUrl) || a.accountId.localeCompare(b.accountId);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const sort = parseSort(url.searchParams.get('sort'));
  const dir = parseDir(url.searchParams.get('dir'));
  const q = url.searchParams.get('q') ?? '';
  const showHidden = url.searchParams.get('hidden') === '1';
  const requestedPage = parsePage(url.searchParams.get('page'));

  const [{ slots, accountErrors, status }, bing] = await Promise.all([
    portfolio.get(db(), { wait: false }),
    getBingWithin(2_000)
  ]);
  const hidden = new Set(listHiddenSites(db()));
  const keyOf = (s: { accountId: string; siteUrl: string }) => `${s.accountId}|${s.siteUrl}`;

  // Totals and the per-account split are over every non-hidden site, as before:
  // the search narrows the table, not the portfolio figures.
  const totals = { sites: 0, clicks: 0, impressions: 0 };
  const perAccountMap = new Map<string, { accountId: string; label: string; email: string; sites: number; clicks: number; impressions: number }>();
  const sites: SiteWithMeta[] = [];
  let hiddenCount = 0;
  const siteDates = listSiteDates(db());
  for (const slot of slots) {
    const s = slot.site;
    const isHidden = hidden.has(keyOf(s));
    const summary = summaryOf(slot, days);
    if (isHidden) hiddenCount++;
    else {
      totals.sites++;
      let a = perAccountMap.get(s.accountId);
      if (!a) perAccountMap.set(s.accountId, (a = { accountId: s.accountId, label: s.accountLabel ?? s.accountEmail, email: s.accountEmail, sites: 0, clicks: 0, impressions: 0 }));
      a.sites++;
      if (summary.summary) {
        totals.clicks += summary.summary.clicks;
        totals.impressions += summary.summary.impressions;
        a.clicks += summary.summary.clicks;
        a.impressions += summary.summary.impressions;
      }
    }
    if (isHidden && !showHidden) continue;
    if (!matchesSiteDomain(s.siteUrl, q)) continue;
    sites.push({ ...s, ...summary, createdAt: siteDates.get(siteToHost(s.siteUrl)) ?? null });
  }
  sites.sort((a, b) => compareSites(a, b, sort, dir));
  const paged = paginate(sites, requestedPage);

  // Only the rows on this page get the per-row extras.
  const indexNowHosts = listIndexNowHosts(db());
  const pageSites = paged.items.map((s) => {
    const host = siteToHost(s.siteUrl);
    return {
      ...s,
      hidden: hidden.has(keyOf(s)),
      hasIndexNow: indexNowHosts.has(host),
      bing: bing.traffic.get(host) ?? null
    };
  });

  return {
    sites: pageSites,
    totalSites: slots.length,
    hiddenCount,
    showHidden,
    totals,
    perAccount: [...perAccountMap.values()].sort((x, y) => y.clicks - x.clicks),
    page: paged.page,
    pageCount: paged.pageCount,
    total: paged.total,
    status,
    errors: accountErrors,
    queryFilters: listQueryFilters(db()),
    days,
    sort,
    dir,
    q
  };
};

// GSC data comes from the in-memory portfolio snapshot (see portfolio.ts).
export const prerender = false;
export const ssr = true;
