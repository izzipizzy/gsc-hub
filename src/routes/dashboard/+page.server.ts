import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { fetchDailyBreakdown } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';

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

const SORT_FIELDS = ['clicks', 'impressions'] as const;
type SortField = (typeof SORT_FIELDS)[number];

function parseSort(raw: string | null): SortField {
  return (SORT_FIELDS as readonly string[]).includes(raw ?? '') ? (raw as SortField) : 'clicks';
}

function parseDir(raw: string | null): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

export const load: PageServerLoad = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const cols = parseCols(url.searchParams.get('cols'));
  const sort = parseSort(url.searchParams.get('sort'));
  const dir = parseDir(url.searchParams.get('dir'));
  const { entries, errors } = await fetchDailyBreakdown(db(), days);
  const other = sort === 'clicks' ? 'impressions' : 'clicks';
  const sorted = [...entries].sort((a, b) => {
    const primary = a.currentTotals[sort] - b.currentTotals[sort];
    const signed = dir === 'asc' ? primary : -primary;
    if (signed !== 0) return signed;
    const od = b.currentTotals[other] - a.currentTotals[other];
    if (od !== 0) return od;
    return a.siteUrl.localeCompare(b.siteUrl);
  });
  return { entries: sorted, errors, days, cols, sort, dir };
};

export const prerender = false;
export const ssr = true;
