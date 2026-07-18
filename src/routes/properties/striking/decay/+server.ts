import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchPortfolioDecayPages } from '$lib/server/google';
import { listAccounts } from '$lib/server/accounts';
import { listHiddenSites } from '$lib/server/hidden';
import { requireAdmin } from '$lib/server/guard';
import { rowToPage, computeDecay } from '$lib/server/analytics';

function parseDays(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(n, 480);
}

// Portfolio-wide content decay. Heavier than the other tabs (2 GSC calls per site) — loaded lazily.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const { entries, errors } = await fetchPortfolioDecayPages(db(), days);
  const hidden = new Set(listHiddenSites(db()));
  const emailById = new Map(listAccounts(db()).map((a) => [a.id, a.email]));

  const out: {
    siteUrl: string;
    accountId: string;
    accountEmail: string;
    page: string;
    priorClicks: number;
    recentClicks: number;
    deltaClicksPct: number;
    lostClicks: number;
    priorImpressions: number;
    recentImpressions: number;
    deltaImprPct: number;
    lostImpressions: number;
  }[] = [];

  for (const e of entries) {
    if (hidden.has(`${e.accountId}|${e.siteUrl}`)) continue;
    for (const d of computeDecay(e.recent.map(rowToPage), e.prior.map(rowToPage), 1000)) {
      out.push({ siteUrl: e.siteUrl, accountId: e.accountId, accountEmail: emailById.get(e.accountId) ?? '', ...d });
    }
  }
  out.sort((a, b) => b.lostImpressions - a.lostImpressions);

  return json({ rows: out.slice(0, 300), total: out.length, days, errors });
};
