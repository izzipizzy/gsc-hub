import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { portfolio, pulseOf } from '$lib/server/portfolio';
import { listHiddenSites } from '$lib/server/hidden';
import { getAlgoUpdates, updatesForChart } from '$lib/server/algo-updates';
import { listSiteEvents, toChartEvents, hostOfSite } from '$lib/server/site-events';
import { requireAdmin } from '$lib/server/guard';

// Portfolio pulse: aggregated daily clicks/impressions across every connected site,
// with Google update rollouts and custom events (domain merges) projected onto the
// same window. Summed from the portfolio snapshot — no requests of its own.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = Number(url.searchParams.get('days') ?? '180');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const { slots, accountErrors, status } = await portfolio.get(db(), { wait: false });
  const { totals, series, siteUrls } = pulseOf(slots, days, new Set(listHiddenSites(db())));

  // Annotations are decoration: an unreachable updates feed must not fail the chart.
  let updates: ReturnType<typeof updatesForChart> = [];
  try {
    const { updates: all } = await getAlgoUpdates();
    updates = updatesForChart(all, series);
  } catch {
    // chart draws without markers
  }

  // Events are per-target-domain; on the aggregate only those of included sites count.
  const hostSet = new Set(siteUrls.map(hostOfSite));
  const events = toChartEvents(listSiteEvents(db()).filter((e) => hostSet.has(e.siteHost)), series.map((r) => r.date));

  return json({ totals, series, updates, events, errors: accountErrors, status });
};
