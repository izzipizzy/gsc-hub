import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { fetchSiteDecayPages } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';
import { rowToPage, computeDecay } from '$lib/server/analytics';

// Two page-level windows (recent vs ~3 months ago) → content-decay table.
export const GET: RequestHandler = async ({ params, url, locals }) => {
  requireAdmin(locals);
  const accId = url.searchParams.get('acc');
  if (!accId) throw error(400, 'acc required');
  const acc = getAccount(db(), accId);
  if (!acc) throw error(404, 'account not found');

  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const { recent, prior } = await fetchSiteDecayPages(db(), acc, params.site, days);
  return json({ days, decay: computeDecay(recent.map(rowToPage), prior.map(rowToPage)) });
};
