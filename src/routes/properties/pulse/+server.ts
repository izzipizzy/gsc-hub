import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchPortfolioDaily } from '$lib/server/google';
import { getAlgoUpdates, updatesForChart } from '$lib/server/algo-updates';
import { listSiteEvents, toChartEvents } from '$lib/server/site-events';
import { requireAdmin } from '$lib/server/guard';

// Portfolio pulse: aggregated daily clicks/impressions across every connected site,
// with Google update rollouts and custom events (domain merges) projected onto the
// same window. The sites list page calls this lazily so the heavy fan-out never
// blocks the main render.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = Number(url.searchParams.get('days') ?? '180');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const { daily, hosts, errors } = await fetchPortfolioDaily(db(), days);

  // Annotations are decoration: an unreachable updates feed must not fail the chart.
  let updates: ReturnType<typeof updatesForChart> = [];
  try {
    const { updates: all } = await getAlgoUpdates();
    updates = updatesForChart(all, daily.series);
  } catch {
    // chart draws without markers
  }

  // Events are per-target-domain; on the aggregate only those of included sites count.
  const hostSet = new Set(hosts);
  const events = toChartEvents(listSiteEvents(db()).filter((e) => hostSet.has(e.siteHost)));

  return json({ ...daily, updates, events, errors });
};
