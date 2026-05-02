import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { fetchDailyBreakdown } from '$lib/server/google';

const ALLOWED_DAYS = [3, 7, 28] as const;
type AllowedDays = (typeof ALLOWED_DAYS)[number];

const ALLOWED_COLS = [2, 4, 6] as const;
type AllowedCols = (typeof ALLOWED_COLS)[number];

function parseDays(raw: string | null): AllowedDays {
  const n = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(n) ? (n as AllowedDays) : 28;
}

function parseCols(raw: string | null): AllowedCols {
  const n = Number(raw);
  return (ALLOWED_COLS as readonly number[]).includes(n) ? (n as AllowedCols) : 4;
}

export const load: PageServerLoad = async ({ url }) => {
  const days = parseDays(url.searchParams.get('days'));
  const cols = parseCols(url.searchParams.get('cols'));
  const { entries, errors } = await fetchDailyBreakdown(db(), days);
  const sorted = [...entries].sort((a, b) => {
    const dc = b.currentTotals.clicks - a.currentTotals.clicks;
    if (dc !== 0) return dc;
    const di = b.currentTotals.impressions - a.currentTotals.impressions;
    if (di !== 0) return di;
    return a.siteUrl.localeCompare(b.siteUrl);
  });
  return { entries: sorted, errors, days, cols };
};

export const prerender = false;
export const ssr = true;
