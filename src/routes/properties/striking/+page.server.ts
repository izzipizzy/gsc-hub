import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { fetchPerSiteQueries } from '$lib/server/google';
import { listHiddenSites } from '$lib/server/hidden';
import { getBrandedTerms } from '$lib/server/branded';
import { requireAdmin } from '$lib/server/guard';
import {
  computeCannibalization,
  computeCtrBenchmark,
  splitBranded,
  aggregateByQuery,
  STRIKING_POS_MIN,
  STRIKING_POS_MAX,
  STRIKING_MIN_IMPRESSIONS,
  type QueryPageRow,
  type CannibalPage
} from '$lib/server/analytics';

function parseDays(raw: string | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 28;
  return Math.min(n, 480);
}

interface SiteTag {
  siteUrl: string;
  accountId: string;
}

const TABS = ['striking', 'cannibal', 'ctr', 'branded', 'decay'] as const;

// In-memory TTL cache of the portfolio fan-out, keyed by period. Keeps GSC data out of the DB
// (only tokens live there) while making repeat loads / period switches instant. Cleared on restart.
interface PortfolioData {
  errors: { accountId: string; accountEmail: string; reason: string }[];
  striking: (SiteTag & {
    query: string;
    page: string;
    country: string;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
  })[];
  strikingTotal: number;
  cannibal: (SiteTag & {
    query: string;
    winner: string;
    totalImpressions: number;
    totalClicks: number;
    pages: CannibalPage[];
  })[];
  cannibalTotal: number;
  ctr: {
    buckets: ReturnType<typeof computeCtrBenchmark>['buckets'];
    opportunities: (SiteTag & {
      query: string;
      page: string;
      position: number;
      impressions: number;
      clicks: number;
      ctr: number;
      benchmark: number;
    })[];
    opportunitiesTotal: number;
  };
  branded: {
    total: {
      branded: { clicks: number; impressions: number };
      nonBranded: { clicks: number; impressions: number };
      brandedPct: number;
    };
    perSite: (SiteTag & {
      branded: { clicks: number; impressions: number };
      nonBranded: { clicks: number; impressions: number };
      brandedPct: number;
    })[];
  };
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<number, { data: PortfolioData; expires: number }>();

// Portfolio-wide analytics across every non-hidden site, all from a single query+page fan-out:
// Striking distance, Cannibalization, CTR benchmark and Branded split. (Decay is heavier — a
// separate 2-window fan-out — and loads lazily via ./decay.)
async function buildPortfolio(days: number): Promise<PortfolioData> {
  const hit = cache.get(days);
  if (hit && hit.expires > Date.now()) return hit.data;

  const { entries, errors } = await fetchPerSiteQueries(db(), days);
  const hidden = new Set(listHiddenSites(db()));

  const striking: PortfolioData['striking'] = [];
  const cannibal: PortfolioData['cannibal'] = [];
  const ctrOpportunities: PortfolioData['ctr']['opportunities'] = [];
  const allRows: QueryPageRow[] = [];
  const brandedPerSite: PortfolioData['branded']['perSite'] = [];
  const brandedTotal = {
    branded: { clicks: 0, impressions: 0 },
    nonBranded: { clicks: 0, impressions: 0 }
  };

  for (const entry of entries) {
    if (hidden.has(`${entry.accountId}|${entry.siteUrl}`)) continue;
    const tag: SiteTag = { siteUrl: entry.siteUrl, accountId: entry.accountId };

    // The fan-out splits rows by country; collapse to query+page (impression-weighted position).
    const agg = new Map<string, QueryPageRow>();
    for (const r of entry.rows) {
      if (!r.query || !r.page) continue;
      const k = `${r.query}\n${r.page}`;
      const cur = agg.get(k) ?? { query: r.query, page: r.page, clicks: 0, impressions: 0, ctr: 0, position: 0 };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.position += r.position * r.impressions;
      agg.set(k, cur);
    }
    const rows: QueryPageRow[] = [...agg.values()].map((c) => ({
      query: c.query,
      page: c.page,
      clicks: c.clicks,
      impressions: c.impressions,
      position: c.impressions > 0 ? c.position / c.impressions : 0,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0
    }));

    // Striking distance is country-specific (position differs by country), so keep the raw
    // per-country rows here instead of the collapsed ones.
    for (const r of entry.rows) {
      if (!r.query || !r.page) continue;
      if (
        r.position >= STRIKING_POS_MIN &&
        r.position <= STRIKING_POS_MAX &&
        r.impressions >= STRIKING_MIN_IMPRESSIONS
      ) {
        striking.push({
          ...tag,
          query: r.query,
          page: r.page,
          country: r.country,
          position: r.position,
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: r.ctr
        });
      }
    }

    for (const g of computeCannibalization(rows, 1000)) {
      cannibal.push({
        ...tag,
        query: g.query,
        winner: g.winner,
        totalImpressions: g.totalImpressions,
        totalClicks: g.totalClicks,
        pages: g.pages
      });
    }

    for (const o of computeCtrBenchmark(rows, 1000).opportunities) {
      ctrOpportunities.push({
        ...tag,
        query: o.query,
        page: o.page,
        position: o.position,
        impressions: o.impressions,
        clicks: o.clicks,
        ctr: o.ctr,
        benchmark: o.benchmark
      });
    }
    allRows.push(...rows);

    const split = splitBranded(aggregateByQuery(rows), getBrandedTerms(db(), entry.siteUrl));
    brandedPerSite.push({ ...tag, branded: split.branded, nonBranded: split.nonBranded, brandedPct: split.brandedPct });
    brandedTotal.branded.clicks += split.branded.clicks;
    brandedTotal.branded.impressions += split.branded.impressions;
    brandedTotal.nonBranded.clicks += split.nonBranded.clicks;
    brandedTotal.nonBranded.impressions += split.nonBranded.impressions;
  }

  // Portfolio CTR-by-position buckets from every row combined (opportunities collected per site).
  const ctrBuckets = computeCtrBenchmark(allRows, 0).buckets;

  striking.sort((a, b) => b.impressions - a.impressions);
  cannibal.sort((a, b) => b.totalImpressions - a.totalImpressions);
  ctrOpportunities.sort((a, b) => b.impressions - a.impressions);
  brandedPerSite.sort(
    (a, b) => b.branded.clicks + b.nonBranded.clicks - (a.branded.clicks + a.nonBranded.clicks)
  );

  const totalClicks = brandedTotal.branded.clicks + brandedTotal.nonBranded.clicks;

  const data: PortfolioData = {
    errors,
    striking: striking.slice(0, 500),
    strikingTotal: striking.length,
    cannibal: cannibal.slice(0, 300),
    cannibalTotal: cannibal.length,
    ctr: {
      buckets: ctrBuckets,
      opportunities: ctrOpportunities.slice(0, 300),
      opportunitiesTotal: ctrOpportunities.length
    },
    branded: {
      total: {
        branded: brandedTotal.branded,
        nonBranded: brandedTotal.nonBranded,
        brandedPct: totalClicks > 0 ? brandedTotal.branded.clicks / totalClicks : 0
      },
      perSite: brandedPerSite.slice(0, 200)
    }
  };

  cache.set(days, { data, expires: Date.now() + TTL_MS });
  return data;
}

export const load: PageServerLoad = ({ url, locals }) => {
  requireAdmin(locals);
  const days = parseDays(url.searchParams.get('days'));
  const tabParam = url.searchParams.get('tab');
  const initialTab = (TABS as readonly string[]).includes(tabParam ?? '') ? tabParam! : 'striking';

  // Return the promise UN-awaited so SvelteKit streams it: the page shell renders immediately
  // and the (cached) portfolio data fills in when ready, instead of blocking navigation.
  return { days, initialTab, portfolio: buildPortfolio(days) };
};

export const prerender = false;
export const ssr = true;
