import { matchesSiteDomain, siteDomain } from '$lib/utils/site';
import { paginate, parsePage } from '$lib/utils/paging';
import { FAVS_COOKIE, parseFavs } from '$lib/utils/favs';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { canCompare } from '$lib/server/google';
import { completedDayRange } from '$lib/server/gsc-calendar';
import { portfolio, breakdownOf, totalsBetween } from '$lib/server/portfolio';
import { listHiddenSites } from '$lib/server/hidden';
import { requireAdmin } from '$lib/server/guard';
import { listSiteEvents, hostOfSite, toChartEvents } from '$lib/server/site-events';

const ALLOWED_COLS = [2, 4, 6] as const;
type AllowedCols = (typeof ALLOWED_COLS)[number];

// Free-form day range, capped at GSC's 16-month window (480 days). Defaults to 28.
function parseDays(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(n, 480);
}

function parseCols(raw: string | null): AllowedCols {
  const n = Number(raw);
  return (ALLOWED_COLS as readonly number[]).includes(n) ? (n as AllowedCols) : 4;
}

const SORT_FIELDS = ['clicks', 'impressions', 'site'] as const;
type SortField = (typeof SORT_FIELDS)[number];

function parseSort(raw: string | null): SortField {
  return (SORT_FIELDS as readonly string[]).includes(raw ?? '') ? (raw as SortField) : 'clicks';
}

function parseDir(raw: string | null): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

type CardGroup = 'fav' | 'rest' | 'hidden';

export const load: PageServerLoad = async ({ url, locals, cookies }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const cols = parseCols(url.searchParams.get('cols'));
  const sort = parseSort(url.searchParams.get('sort'));
  const dir = parseDir(url.searchParams.get('dir'));
  const q = url.searchParams.get('q') ?? '';
  const requestedPage = parsePage(url.searchParams.get('page'));
  const comparable = canCompare(days);

  const { slots, accountErrors, status } = await portfolio.get(db(), { wait: false });
  const hidden = new Set(listHiddenSites(db()));
  const favs = parseFavs(cookies.get(FAVS_COOKIE));
  const { startDate, endDate } = completedDayRange(days);

  // Sorting needs every site's totals; the rows behind the sparklines are
  // built for the hundred cards on the page only.
  const rows = slots
    .filter((s) => matchesSiteDomain(s.site.siteUrl, q))
    .map((slot) => {
      const key = `${slot.site.accountId}|${slot.site.siteUrl}`;
      const group: CardGroup = hidden.has(key) ? 'hidden' : favs.has(key) ? 'fav' : 'rest';
      return { slot, key, group, totals: totalsBetween(slot.value, startDate, endDate), domain: siteDomain(slot.site.siteUrl) };
    });

  const other = sort === 'clicks' ? 'impressions' : 'clicks';
  const groupRank: Record<CardGroup, number> = { fav: 0, rest: 1, hidden: 2 };
  rows.sort((a, b) => {
    const g = groupRank[a.group] - groupRank[b.group];
    if (g !== 0) return g;
    // Ties always fall through to the full key, so the order — and with it
    // every page boundary — is the same on each load.
    const tie = a.slot.site.siteUrl.localeCompare(b.slot.site.siteUrl) || a.slot.site.accountId.localeCompare(b.slot.site.accountId);
    if (sort === 'site') {
      const domain = a.domain.localeCompare(b.domain, 'en', { sensitivity: 'base' });
      return (dir === 'asc' ? 1 : -1) * (domain || tie);
    }
    const primary = a.totals[sort] - b.totals[sort];
    const signed = dir === 'asc' ? primary : -primary;
    if (signed !== 0) return signed;
    const od = b.totals[other] - a.totals[other];
    if (od !== 0) return od;
    return tie;
  });

  const counts = { fav: 0, rest: 0, hidden: 0 };
  for (const r of rows) counts[r.group]++;

  const paged = paginate(rows, requestedPage);

  // Per-site event markers (domain merges etc.) for the card sparklines, matched by
  // host, restricted to each card's current date window.
  const pageHosts = new Set(paged.items.map((r) => hostOfSite(r.slot.site.siteUrl)));
  const eventsByHost = new Map<string, ReturnType<typeof listSiteEvents>>();
  for (const ev of listSiteEvents(db())) {
    if (!pageHosts.has(ev.siteHost)) continue;
    const arr = eventsByHost.get(ev.siteHost) ?? [];
    arr.push(ev);
    eventsByHost.set(ev.siteHost, arr);
  }
  const entries = paged.items.map(({ slot, group }) => {
    const e = breakdownOf(slot, days);
    return {
      ...e,
      group,
      events: toChartEvents(eventsByHost.get(hostOfSite(e.siteUrl)) ?? [], e.current.map((r) => r.date))
    };
  });

  return {
    entries,
    counts,
    totalSites: slots.length,
    page: paged.page,
    pageCount: paged.pageCount,
    total: paged.total,
    status,
    errors: accountErrors,
    days,
    cols,
    sort,
    dir,
    q,
    comparable
  };
};

export const prerender = false;
export const ssr = true;
