import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { searchAnalyticsQuery } from '$lib/server/google';
import { rowsToCsv } from '$lib/server/csv';

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GET: RequestHandler = async ({ url }) => {
  const accountId = url.searchParams.get('account');
  const siteUrl = url.searchParams.get('site');
  const days = Number(url.searchParams.get('days') ?? '28');
  const dim = url.searchParams.get('dim') ?? 'query';

  if (!accountId || !siteUrl) throw error(400, 'account and site required');
  if (dim !== 'query' && dim !== 'page') throw error(400, 'dim must be query|page');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const acc = getAccount(db(), accountId);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  const startDate = dateNDaysAgo(days);
  const endDate = todayIso();

  const rows = await searchAnalyticsQuery(db(), acc, siteUrl, {
    startDate,
    endDate,
    dimensions: [dim],
    rowLimit: 25000
  });

  const csv = rowsToCsv(
    [dim, 'clicks', 'impressions', 'ctr', 'position'],
    rows,
    (r) => [
      r.keys[0] ?? '',
      String(r.clicks),
      String(r.impressions),
      r.ctr.toFixed(6),
      r.position.toFixed(2)
    ]
  );

  const fname = `${siteUrl.replace(/[^a-z0-9]+/gi, '_')}_${dim}_${startDate}_${endDate}.csv`;

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`
    }
  });
};
