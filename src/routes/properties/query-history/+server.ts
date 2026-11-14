import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchQueryHistory } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';
import { listHiddenSites } from '$lib/server/hidden';

export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const q = url.searchParams.get('q');
  const days = Number(url.searchParams.get('days') ?? '480');
  if (!q) throw error(400, 'q required');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const result = await fetchQueryHistory(db(), q, days);
  // Hidden sites are dropped here: the page no longer holds the hidden set.
  const hidden = new Set(listHiddenSites(db()));
  return json({ ...result, entries: result.entries.filter((e) => !hidden.has(`${e.accountId}|${e.siteUrl}`)) });
};
