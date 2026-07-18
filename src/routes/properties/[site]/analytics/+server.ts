import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { fetchSiteQueryPages } from '$lib/server/google';
import { getBrandedTerms } from '$lib/server/branded';
import { requireAdmin } from '$lib/server/guard';
import {
  rowToQueryPage,
  computeStriking,
  computeCannibalization,
  computeCtrBenchmark,
  splitBranded,
  aggregateByQuery
} from '$lib/server/analytics';

// One GSC query+page fetch → Striking, Cannibalization, CTR benchmark and Branded split.
export const GET: RequestHandler = async ({ params, url, locals }) => {
  requireAdmin(locals);
  const accId = url.searchParams.get('acc');
  if (!accId) throw error(400, 'acc required');
  const acc = getAccount(db(), accId);
  if (!acc) throw error(404, 'account not found');

  const siteUrl = params.site;
  const rows = await fetchSiteQueryPages(db(), acc, siteUrl);
  const qp = rows.map(rowToQueryPage);
  const terms = getBrandedTerms(db(), siteUrl);

  return json({
    striking: computeStriking(qp),
    cannibalization: computeCannibalization(qp),
    ctr: computeCtrBenchmark(qp),
    branded: splitBranded(aggregateByQuery(qp), terms),
    brandedTerms: terms
  });
};
