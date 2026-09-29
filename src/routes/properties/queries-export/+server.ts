import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchPerSiteQueries } from '$lib/server/google';
import { filterPatterns, queryHidden } from '$lib/server/filters';
import { rowsToCsv } from '$lib/server/csv';
import { requireAdmin } from '$lib/server/guard';

// All queries across visible sites for the period, aggregated by query × country,
// with junk-query filters applied. Columns: query, country, impressions, clicks.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const days = Math.floor(Number(url.searchParams.get('days') ?? '1'));
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  // accountId|siteUrl keys the client wants excluded (mirrors the UI's hidden set).
  const hidden = new Set((url.searchParams.get('hidden') ?? '').split(',').filter(Boolean));

  const filters = filterPatterns(db());
  const isFiltered = (q: string) => queryHidden(q, filters);

  const { entries } = await fetchPerSiteQueries(db(), days, 25000);

  const map = new Map<string, { query: string; country: string; clicks: number; impressions: number }>();
  for (const e of entries) {
    if (hidden.has(`${e.accountId}|${e.siteUrl}`)) continue;
    for (const r of e.rows) {
      if (!r.query || isFiltered(r.query)) continue;
      const key = `${r.query}|${r.country}`;
      const cur = map.get(key) ?? { query: r.query, country: r.country, clicks: 0, impressions: 0 };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      map.set(key, cur);
    }
  }
  const rows = [...map.values()].sort((a, b) => b.impressions - a.impressions);

  const csv = rowsToCsv(
    ['query', 'country', 'impressions', 'clicks'],
    rows,
    (r) => [r.query, r.country, String(r.impressions), String(r.clicks)]
  );

  const fname = `gsc_queries_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`
    }
  });
};
