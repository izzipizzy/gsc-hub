import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { fetchSiteQueryPages } from '$lib/server/google';
import { getBrandedTerms } from '$lib/server/branded';
import { requireAdmin } from '$lib/server/guard';
import { dropFilteredQueries, filterPatterns } from '$lib/server/filters';
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

  // Период берём из запроса: переключатель наверху страницы должен двигать и
  // эти вкладки, а не только график Overview.
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const siteUrl = params.site;
  const rows = await fetchSiteQueryPages(db(), acc, siteUrl, days);
  // Те же фильтры мусорных запросов, что на странице сайтов и в экспорте:
  // `site:` — оператор поиска, а не ключ.
  const qp = dropFilteredQueries(rows.map(rowToQueryPage), filterPatterns(db()), (r) => r.query);
  const terms = getBrandedTerms(db(), siteUrl);

  // Потолок на один сайт выше дефолтного: за 60-480 дней в striking легко
  // набирается больше сотни запросов, и обрезать их молча — врать о картине.
  return json({
    days,
    striking: computeStriking(qp, 300),
    cannibalization: computeCannibalization(qp, 200),
    ctr: computeCtrBenchmark(qp, 200),
    branded: splitBranded(aggregateByQuery(qp), terms),
    brandedTerms: terms
  });
};
