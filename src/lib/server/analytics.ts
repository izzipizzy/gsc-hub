// Pure GSC analytics — no network, no SQL. Operates on rows already fetched by google.ts.
// Every function here is deterministic and unit-tested (tests/analytics.test.ts).

import { SHORT_TERM_MAX, normalizeForMatch } from '$lib/utils/branded';
import type { SearchAnalyticsRow } from './google';

// A GSC row from dims ['query','page'].
export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
}

// A GSC row from dims ['page'].
export interface PageRow {
  page: string;
  clicks: number;
  impressions: number;
}

// ─── thresholds (constants, intentionally not user-configurable) ──────────────
export const STRIKING_POS_MIN = 4;
export const STRIKING_POS_MAX = 20;
export const STRIKING_MIN_IMPRESSIONS = 10;
export const CANNIBAL_MIN_IMPRESSIONS = 10;
export const DECAY_MIN_PRIOR_CLICKS = 20;
export const DECAY_MIN_PRIOR_IMPRESSIONS = 50;
export const DECAY_DROP_THRESHOLD = -0.2; // lost >= 20%
export const CTR_OPP_MIN_IMPRESSIONS = 10;
export const CTR_OPP_FACTOR = 0.7; // below 70% of benchmark = opportunity

// Reference CTR by rounded SERP position 1..10 (approx industry averages, fractions 0..1).
export const BENCHMARK_CTR: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.07,
  6: 0.05,
  7: 0.04,
  8: 0.032,
  9: 0.028,
  10: 0.025
};

// ─── row adapters (from raw GSC SearchAnalyticsRow) ───────────────────────────
export function rowToQueryPage(r: SearchAnalyticsRow): QueryPageRow {
  return {
    query: r.keys[0] ?? '',
    page: r.keys[1] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position
  };
}

export function rowToPage(r: SearchAnalyticsRow): PageRow {
  return { page: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions };
}

// ─── Striking distance ────────────────────────────────────────────────────────
export type StrikingRow = QueryPageRow;

export function computeStriking(rows: QueryPageRow[], limit = 100): StrikingRow[] {
  return rows
    .filter(
      (r) =>
        r.position >= STRIKING_POS_MIN &&
        r.position <= STRIKING_POS_MAX &&
        r.impressions >= STRIKING_MIN_IMPRESSIONS
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

// ─── Keyword cannibalization ──────────────────────────────────────────────────
export interface CannibalPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
}

export interface CannibalGroup {
  query: string;
  totalClicks: number;
  totalImpressions: number;
  pages: CannibalPage[]; // sorted, winner first
  winner: string; // page url with most clicks
}

export function computeCannibalization(rows: QueryPageRow[], limit = 100): CannibalGroup[] {
  const byQuery = new Map<string, QueryPageRow[]>();
  for (const r of rows) {
    if (!r.query || !r.page) continue;
    const arr = byQuery.get(r.query) ?? [];
    arr.push(r);
    byQuery.set(r.query, arr);
  }

  const groups: CannibalGroup[] = [];
  for (const [query, list] of byQuery) {
    const competing = list.filter((r) => r.impressions >= CANNIBAL_MIN_IMPRESSIONS);
    if (competing.length < 2) continue;
    const pages = competing
      .map((r) => ({
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position,
        ctr: r.ctr
      }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    groups.push({
      query,
      totalClicks: pages.reduce((s, p) => s + p.clicks, 0),
      totalImpressions: pages.reduce((s, p) => s + p.impressions, 0),
      pages,
      winner: pages[0].page
    });
  }

  return groups.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, limit);
}

// ─── CTR benchmark ────────────────────────────────────────────────────────────
export interface CtrBucket {
  position: number;
  yourCtr: number;
  benchmark: number;
  impressions: number;
  clicks: number;
}

export interface CtrOpportunity extends QueryPageRow {
  benchmark: number;
}

export interface CtrBenchmarkResult {
  buckets: CtrBucket[];
  opportunities: CtrOpportunity[];
}

export function computeCtrBenchmark(rows: QueryPageRow[], oppLimit = 100): CtrBenchmarkResult {
  const agg = new Map<number, { impressions: number; clicks: number }>();
  for (const r of rows) {
    const pos = Math.round(r.position);
    if (pos < 1 || pos > 10) continue;
    const a = agg.get(pos) ?? { impressions: 0, clicks: 0 };
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    agg.set(pos, a);
  }

  const buckets: CtrBucket[] = [];
  for (let pos = 1; pos <= 10; pos++) {
    const a = agg.get(pos);
    if (!a || a.impressions === 0) continue;
    buckets.push({
      position: pos,
      yourCtr: a.clicks / a.impressions,
      benchmark: BENCHMARK_CTR[pos],
      impressions: a.impressions,
      clicks: a.clicks
    });
  }

  const opportunities = rows
    .filter((r) => {
      const pos = Math.round(r.position);
      if (pos < 1 || pos > 10) return false;
      if (r.impressions < CTR_OPP_MIN_IMPRESSIONS) return false;
      return r.ctr < BENCHMARK_CTR[pos] * CTR_OPP_FACTOR;
    })
    .map((r) => ({ ...r, benchmark: BENCHMARK_CTR[Math.round(r.position)] }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, oppLimit);

  return { buckets, opportunities };
}

// ─── Branded vs non-branded ───────────────────────────────────────────────────
export interface BrandedSplit {
  branded: { clicks: number; impressions: number };
  nonBranded: { clicks: number; impressions: number };
  brandedPct: number; // share of clicks 0..1 (0 when no clicks)
}

// See SHORT_TERM_MAX for why the line sits here.
const SUBSTRING_SAFE_LENGTH = SHORT_TERM_MAX + 1;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Short terms match only where they stand as their own word, so "co" catches
// "co uk" and "co-op" but not "discount code". Longer ones keep matching as
// substrings, because a real brand name is worth finding even glued to
// something ("examplelogin"). Boundaries are Unicode-aware: \b would treat
// every Cyrillic letter as a boundary and make short terms match everywhere.
function termMatcher(term: string): (query: string) => boolean {
  if (term.length >= SUBSTRING_SAFE_LENGTH) return (q) => q.includes(term);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'u');
  return (q) => re.test(q);
}

export function splitBranded(
  queryRows: { query: string; clicks: number; impressions: number }[],
  terms: string[]
): BrandedSplit {
  const lc = terms.map((t) => normalizeForMatch(t.trim())).filter(Boolean);
  const matchers = lc.map(termMatcher);
  const branded = { clicks: 0, impressions: 0 };
  const nonBranded = { clicks: 0, impressions: 0 };
  for (const r of queryRows) {
    const q = normalizeForMatch(r.query);
    const isBrand = matchers.some((m) => m(q));
    const bucket = isBrand ? branded : nonBranded;
    bucket.clicks += r.clicks;
    bucket.impressions += r.impressions;
  }
  const total = branded.clicks + nonBranded.clicks;
  return { branded, nonBranded, brandedPct: total > 0 ? branded.clicks / total : 0 };
}

// Aggregate query+page rows down to per-query totals (for the branded split).
export function aggregateByQuery(
  rows: QueryPageRow[]
): { query: string; clicks: number; impressions: number }[] {
  const m = new Map<string, { query: string; clicks: number; impressions: number }>();
  for (const r of rows) {
    const e = m.get(r.query) ?? { query: r.query, clicks: 0, impressions: 0 };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    m.set(r.query, e);
  }
  return [...m.values()];
}

// ─── Content decay ────────────────────────────────────────────────────────────
export interface DecayRow {
  page: string;
  priorClicks: number;
  recentClicks: number;
  deltaClicksPct: number; // negative = decay
  lostClicks: number;
  priorImpressions: number;
  recentImpressions: number;
  deltaImprPct: number;
  lostImpressions: number;
}

// A page decays if it lost >= 20% on clicks (from >= 20 prior clicks) OR on impressions
// (from >= 50 prior impressions) — impressions catch visibility loss on low-click pages.
// "Prior" is the period immediately before "recent" (see fetchSiteDecayPages).
// Sorted by absolute impressions lost (the broader signal).
export function computeDecay(recent: PageRow[], prior: PageRow[], limit = 100): DecayRow[] {
  const recentMap = new Map(recent.map((r) => [r.page, r]));
  const out: DecayRow[] = [];
  for (const p of prior) {
    const r = recentMap.get(p.page);
    const recentClicks = r?.clicks ?? 0;
    const recentImpressions = r?.impressions ?? 0;

    const clicksQualify = p.clicks >= DECAY_MIN_PRIOR_CLICKS;
    const imprQualify = p.impressions >= DECAY_MIN_PRIOR_IMPRESSIONS;
    if (!clicksQualify && !imprQualify) continue;

    const deltaClicksPct = p.clicks > 0 ? (recentClicks - p.clicks) / p.clicks : 0;
    const deltaImprPct = p.impressions > 0 ? (recentImpressions - p.impressions) / p.impressions : 0;

    const clicksDecayed = clicksQualify && deltaClicksPct <= DECAY_DROP_THRESHOLD;
    const imprDecayed = imprQualify && deltaImprPct <= DECAY_DROP_THRESHOLD;
    if (!clicksDecayed && !imprDecayed) continue;

    out.push({
      page: p.page,
      priorClicks: p.clicks,
      recentClicks,
      deltaClicksPct,
      lostClicks: p.clicks - recentClicks,
      priorImpressions: p.impressions,
      recentImpressions,
      deltaImprPct,
      lostImpressions: p.impressions - recentImpressions
    });
  }
  return out.sort((a, b) => b.lostImpressions - a.lostImpressions).slice(0, limit);
}
