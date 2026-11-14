import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { listHiddenSites } from '$lib/server/hidden';
import { filterPatterns } from '$lib/server/filters';
import { getBingWithin } from '$lib/server/bing';
import { requireAdmin } from '$lib/server/guard';
import {
  allQueries,
  gscRowCount,
  sitePages,
  topPages,
  topQueries,
  topStore,
  type PageSort,
  type QuerySort,
  type QuerySource,
  type TopQueryRow
} from '$lib/server/portfolio-top';

const QUERY_SORTS: QuerySort[] = ['query', 'page', 'country', 'clicks', 'impressions', 'ctr', 'position', 'bingClicks', 'bingImpr'];
const PAGE_SORTS: PageSort[] = ['page', 'clicks', 'impressions', 'ctr', 'position'];
const SOURCES: QuerySource[] = ['all', 'gsc', 'bing', 'both'];

function pick<T extends string>(raw: string | null, allowed: T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}
function list(raw: string | null): Set<string> {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}
function num(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// The merged GSC × Bing list only changes when the store, the hidden set or
// Bing does; filter and sort changes reuse it.
let memo: { key: string; all: TopQueryRow[]; sourceRows: number } | null = null;

// Top queries / top pages of the /properties page, aggregated here so the
// browser receives the 200 rows it shows. `kind=site-pages` serves one site's
// pages to the inspection panel.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = Math.floor(Number(url.searchParams.get('days') ?? '1'));
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  const kind = url.searchParams.get('kind') ?? 'queries';

  if (kind === 'site-pages') {
    const acc = getAccount(db(), url.searchParams.get('account') ?? '');
    const site = url.searchParams.get('site') ?? '';
    if (!acc || !site) throw error(400, 'account and site required');
    return json({ pages: await sitePages(db(), acc, site, days) });
  }

  const { slots, status } = await topStore(days).get(db(), { wait: false });
  const hiddenList = listHiddenSites(db());
  const hidden = new Set(hiddenList);
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  const limit = Math.floor(Number(url.searchParams.get('limit') ?? '200'));

  if (kind === 'pages') {
    const sort = pick(url.searchParams.get('sort'), PAGE_SORTS, 'impressions');
    return json({ ...topPages(slots, hidden, sort, dir, limit), status });
  }
  if (kind !== 'queries') throw error(400, 'kind: queries | pages | site-pages');

  const bing = await getBingWithin(2_000);
  const key = [days, status.startedAt, status.done, status.updatedAt, hiddenList.join(','), bing.queries.length].join('|');
  if (memo?.key !== key) {
    memo = { key, all: allQueries(slots, hidden, bing.queries), sourceRows: gscRowCount(slots, hidden) };
  }
  const result = topQueries(memo.all, memo.sourceRows, {
    sort: pick(url.searchParams.get('sort'), QUERY_SORTS, 'position'),
    dir: url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
    countries: list(url.searchParams.get('countries')),
    domains: list(url.searchParams.get('domains')),
    source: pick(url.searchParams.get('source'), SOURCES, 'gsc'),
    posMin: num(url.searchParams.get('posMin')),
    posMax: num(url.searchParams.get('posMax')),
    showFiltered: url.searchParams.get('showFiltered') === '1',
    patterns: filterPatterns(db())
  }, limit);
  return json({ ...result, status });
};
