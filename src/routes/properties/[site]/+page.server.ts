import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { fetchSiteDaily } from '$lib/server/google';
import { getBrandedTerms } from '$lib/server/branded';
import { requireAdmin } from '$lib/server/guard';
import {
  getAlgoUpdates,
  updatesForChart
} from '$lib/server/algo-updates';
import { listSiteEventsForSite, toChartEvents, SITE_EVENT_TYPES } from '$lib/server/site-events';
import { purchaseSummary } from '$lib/server/magiclinks-purchases';
import { anyMagicProviderConfigured } from '$lib/server/magiclinks-providers';
import { listUrlExclusions } from '$lib/server/site-url-exclusions';
import { siteHostname } from '$lib/utils/url-filters';
import { getSiteViewSettings, saveSiteViewSettings } from '$lib/server/site-view-settings';

// Free-form day range, capped at GSC's 16-month window (480 days). Defaults to 28.
function parseDays(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(n, 480);
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
  requireAdmin(locals);
  const accId = url.searchParams.get('acc');
  if (!accId) throw error(400, 'acc query param required');
  const acc = getAccount(db(), accId);
  if (!acc) throw error(404, 'account not found');

  const siteUrl = params.site;
  const savedView = getSiteViewSettings(db(), siteUrl);
  const days = url.searchParams.has('days') ? parseDays(url.searchParams.get('days')) : savedView.days;
  // An explicit period in a link wins; entering from Sites/Dashboard restores the saved one.
  if (days !== savedView.days) saveSiteViewSettings(db(), siteUrl, { days });
  let daily = null;
  let dailyError: string | null = null;
  try {
    daily = await fetchSiteDaily(db(), acc, siteUrl, days);
  } catch (e) {
    dailyError = (e as Error).message.slice(0, 200);
  }

  // The updates feed is fetched per process and cached for an hour; when unreachable
  // (local install) it falls back to the built-in list without surfacing an error —
  // a chart without this month's marker still draws.
  let algoUpdates: ReturnType<typeof updatesForChart> = [];
  let algoSource: 'google' | 'builtin' = 'builtin';
  if (daily) {
    try {
      const { updates, source } = await getAlgoUpdates();
      algoUpdates = updatesForChart(updates, daily.series);
      algoSource = source;
    } catch {
      // annotations are decoration; the chart must draw without them
    }
  }

  const eventRows = listSiteEventsForSite(db(), siteUrl);

  return {
    siteUrl,
    accId,
    days,
    viewSettings: { ...savedView, days },
    account: { email: acc.email, label: acc.label },
    daily,
    dailyError,
    algoUpdates,
    algoSource,
    siteEvents: toChartEvents(eventRows),
    eventRows,
    eventTypes: SITE_EVENT_TYPES,
    brandedTerms: getBrandedTerms(db(), siteUrl),
    urlExclusions: listUrlExclusions(db(), siteUrl),
    // Покупки MagicLinks этого сайта: хост берём из property, чтобы sc-domain:
    // и https://host/ давали одну и ту же историю.
    purchases: purchaseSummary(db(), siteHostname(siteUrl)),
    magicLinksReady: anyMagicProviderConfigured(db())
  };
};

// No cache — always live.
export const prerender = false;
export const ssr = true;
