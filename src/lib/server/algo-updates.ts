// Google algorithm updates for chart annotations.
//
// Adapted from OpenGSC (https://github.com/fenjo26/OpenGSC, MIT, notice in THIRD_PARTY_NOTICES.md) — algoUpdates.ts +
// algoUpdatesServer.ts merged into one server module per this repo's isolation rules:
// only src/lib/server knows about network fetches, routes consume the ready list.
//
// Two sources, merged. The built-in list is hand-compiled and stops where it stops;
// Google publishes the live picture as JSON at status.search.google.com/incidents.json —
// undocumented but stable, and it is what the Search Status Dashboard itself renders.
// When the feed is unreachable (the local install has no internet by design) the
// built-in list takes over, so the feature degrades to "slightly stale" instead of
// "empty chart".

export type AlgoUpdateType = 'core' | 'spam' | 'discover' | 'other';

export interface AlgoUpdate {
  date: string; // start date, ISO YYYY-MM-DD
  /** Last day of the rollout, ISO. A core update takes weeks; the day it was announced is not
   *  the day it finished moving rankings, so the chart shades the whole window rather than
   *  drawing a single line and implying an instant event. */
  end?: string;
  name: string; // short label shown on the chart
  type: AlgoUpdateType;
  duration?: string;
  /** Live feed says the rollout has started and not finished yet. */
  ongoing?: boolean;
}

export const ALGO_UPDATE_COLORS: Record<AlgoUpdateType, string> = {
  core: '#f5923c',
  spam: '#e0a324',
  discover: '#f0b35a',
  other: '#d9a066'
};

export const ALGO_UPDATES: AlgoUpdate[] = [
  { date: '2023-08-22', name: 'Aug 2023 Core', type: 'core', duration: '16 days' },
  { date: '2023-10-04', name: 'Oct 2023 Spam', type: 'spam', duration: '16 days' },
  { date: '2023-10-05', name: 'Oct 2023 Core', type: 'core', duration: '14 days' },
  { date: '2023-11-02', name: 'Nov 2023 Core', type: 'core', duration: '26 days' },
  { date: '2023-11-08', name: 'Nov 2023 Reviews', type: 'other', duration: '29 days' },
  { date: '2024-03-05', name: 'Mar 2024 Core', type: 'core', duration: '45 days' },
  { date: '2024-03-05', name: 'Mar 2024 Spam', type: 'spam', duration: '15 days' },
  { date: '2024-06-20', name: 'Jun 2024 Spam', type: 'spam', duration: '7 days' },
  { date: '2024-08-15', name: 'Aug 2024 Core', type: 'core', duration: '19 days' },
  { date: '2024-11-11', name: 'Nov 2024 Core', type: 'core', duration: '24 days' },
  { date: '2024-12-12', name: 'Dec 2024 Core', type: 'core', duration: '6 days' },
  { date: '2024-12-19', name: 'Dec 2024 Spam', type: 'spam', duration: '8 days' },
  { date: '2025-03-13', name: 'Mar 2025 Core', type: 'core', duration: '14 days' },
  { date: '2025-06-30', name: 'Jun 2025 Core', type: 'core', duration: '16 days' },
  { date: '2025-08-26', name: 'Aug 2025 Spam', type: 'spam', duration: '18 days' },
  { date: '2025-12-11', name: 'Dec 2025 Core', type: 'core', duration: '12 days' },
  { date: '2026-02-10', name: 'Feb 2026 Discover', type: 'discover', duration: '8 days' },
  { date: '2026-03-27', name: 'Mar 2026 Core', type: 'core', duration: '12 days' },
  { date: '2026-03-27', name: 'Mar 2026 Spam', type: 'spam', duration: '9 days' }
];

// ─── Impact: change in average daily traffic across a rollout ─────────────────

/** Days on each side of a rollout used to judge its effect. */
const IMPACT_WINDOW = 14;
/** Fewer than this on either side → no verdict at all. */
const IMPACT_MIN_DAYS = 3;
/** Below this on either side, the figure is shown as approximate. */
const IMPACT_CONFIDENT_DAYS = 7;

export interface AlgoImpactPoint {
  dateIso: string;
  clicks?: number;
  impressions?: number;
}

export interface AlgoImpact {
  /** Percent change in average daily clicks/impressions; null when not computable. */
  clicks: number | null;
  impressions: number | null;
  beforeDays: number;
  afterDays: number;
  /** False when either side is short enough that the figure should be read as approximate. */
  confident: boolean;
}

export interface AlgoNeighbours {
  /** End of the previous rollout — nothing before this belongs to the current one. */
  prevEndIso?: string;
  /** Start of the next rollout — nothing after this does either. */
  nextStartIso?: string;
}

/**
 * Change in average daily clicks/impressions across a rollout, measured from before the
 * rollout started to after it finished, skipping the rollout itself: during a two-week core
 * update rankings are mid-flight, and including those days averages the old state and the
 * new one into something that describes neither.
 *
 * This is correlation. Traffic moves for reasons that have nothing to do with Google
 * shipping something — the figure only says what happened around the update.
 */
export function algoImpact(
  chart: AlgoImpactPoint[],
  startIso: string,
  endIso: string,
  neighbours: AlgoNeighbours = {}
): AlgoImpact | { ok: false; reason: 'insufficient' | 'adjacent' } {
  const { prevEndIso, nextStartIso } = neighbours;
  const beforeAll = chart.filter((p) => p.dateIso < startIso && (!prevEndIso || p.dateIso > prevEndIso));
  const afterAll = chart.filter((p) => p.dateIso > endIso && (!nextStartIso || p.dateIso < nextStartIso));
  const before = beforeAll.slice(-IMPACT_WINDOW);
  const after = afterAll.slice(0, IMPACT_WINDOW);

  if (before.length < IMPACT_MIN_DAYS || after.length < IMPACT_MIN_DAYS) {
    const clipped =
      (prevEndIso && chart.some((p) => p.dateIso < startIso && p.dateIso <= prevEndIso)) ||
      (nextStartIso && chart.some((p) => p.dateIso > endIso && p.dateIso >= nextStartIso));
    return { ok: false, reason: clipped ? 'adjacent' : 'insufficient' };
  }

  // Averages, not sums: the two windows are often different lengths near the edge of the
  // period, and comparing totals would report the difference in length as a traffic change.
  const avg = (rows: AlgoImpactPoint[], pick: (p: AlgoImpactPoint) => number | undefined) => {
    const vals = rows.map(pick).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const pct = (b: number | null, a: number | null) =>
    b != null && a != null && b > 0 ? Math.round(((a - b) / b) * 100) : null;

  return {
    clicks: pct(avg(before, (p) => p.clicks), avg(after, (p) => p.clicks)),
    impressions: pct(avg(before, (p) => p.impressions), avg(after, (p) => p.impressions)),
    beforeDays: before.length,
    afterDays: after.length,
    confident: before.length >= IMPACT_CONFIDENT_DAYS && after.length >= IMPACT_CONFIDENT_DAYS
  };
}

// ─── Dates and labels ─────────────────────────────────────────────────────────

/** Days in a "16 days" string, for the built-in entries that predate storing an end date. */
function durationDays(duration?: string): number | null {
  const m = /^(\d+)\s*days?$/i.exec(duration ?? '');
  return m ? parseInt(m[1], 10) : null;
}

/** End date of an update, derived from `duration` when the entry has no explicit `end`. */
export function updateEnd(u: AlgoUpdate): string | null {
  if (u.end) return u.end;
  const days = durationDays(u.duration);
  if (days == null) return null;
  return new Date(Date.parse(`${u.date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Rollout length in days, whichever way the entry records it. */
export function updateDays(u: AlgoUpdate): number | null {
  const fromDuration = durationDays(u.duration);
  if (fromDuration != null) return fromDuration;
  if (!u.end) return null;
  return Math.max(1, Math.round((Date.parse(u.end) - Date.parse(u.date)) / 86_400_000));
}

/** Chart label: the name, plus the rollout length when it is known. */
export function algoChartLabel(u: AlgoUpdate): string {
  const days = updateDays(u);
  return days ? `${u.name} · ${days}d` : u.name;
}

/** Neighbour rollouts for every update, so each one's impact window stays clean. */
export function withNeighbours<T extends AlgoUpdate>(updates: T[]): (T & AlgoNeighbours)[] {
  const sorted = [...updates].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((u, i) => {
    // Latest end among *all* earlier updates: rollouts overlap, and a long core update can
    // still be running when two later ones start.
    let prevEndIso: string | undefined;
    for (let j = 0; j < i; j++) {
      const e = updateEnd(sorted[j]) ?? sorted[j].date;
      if (!prevEndIso || e > prevEndIso) prevEndIso = e;
    }
    return { ...u, prevEndIso, nextStartIso: sorted[i + 1]?.date };
  });
}

// ─── Chart projection ─────────────────────────────────────────────────────────

/** Updates that overlap the chart window, clipped to it, with traffic impact per rollout. */
export function updatesForChart(
  updates: AlgoUpdate[],
  series: { date: string; clicks: number; impressions: number }[]
) {
  if (series.length === 0) return [];
  const rangeStart = series[0].date;
  const rangeEnd = series[series.length - 1].date;

  // Neighbours are computed over everything that could contaminate an impact window,
  // including rollouts that start just before the window and end inside it.
  const relevant = updates.filter((u) => (updateEnd(u) ?? u.date) >= rangeStart && u.date <= rangeEnd);
  const withN = withNeighbours(relevant);

  return withN
    .map((u) => {
      // A rollout still in progress shades to the last day of data: every day of it so far
      // is inside the update, and a one-day line would claim it already ended.
      const end = u.ongoing ? rangeEnd : (updateEnd(u) ?? u.date);
      const impact = algoImpact(
        series.map((p) => ({ dateIso: p.date, clicks: p.clicks, impressions: p.impressions })),
        u.date,
        end,
        { prevEndIso: u.prevEndIso, nextStartIso: u.nextStartIso }
      );
      return {
        date: u.date < rangeStart ? rangeStart : u.date,
        end: end > rangeEnd ? rangeEnd : end,
        name: algoChartLabel(u),
        type: u.type,
        color: ALGO_UPDATE_COLORS[u.type],
        ongoing: u.ongoing === true,
        impact:
          u.ongoing || 'ok' in impact
            ? null // mid-rollout there is no "after" to compare with // { ok:false, reason } — not enough clean data around this rollout
            : { clicks: impact.clicks, confident: impact.confident }
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Google Search Status Dashboard feed ──────────────────────────────────────

/** One incident as published at status.search.google.com/incidents.json. */
interface GoogleIncident {
  begin?: string;
  end?: string;
  external_desc?: string;
  service_name?: string;
  status_impact?: string;
}

/**
 * Turn the status feed into chart markers. Only ranking announcements are kept: the same
 * feed carries serving outages too, and those are incidents, not algorithm updates.
 */
export function mapIncidentsToUpdates(incidents: GoogleIncident[]): AlgoUpdate[] {
  const out: AlgoUpdate[] = [];
  for (const inc of incidents) {
    const desc = (inc.external_desc ?? '').trim();
    const begin = (inc.begin ?? '').slice(0, 10);
    if (!desc || !/^\d{4}-\d{2}-\d{2}$/.test(begin)) continue;
    if (inc.status_impact !== 'SERVICE_INFORMATION') continue;

    const lower = desc.toLowerCase();
    const type: AlgoUpdateType = lower.includes('discover')
      ? 'discover'
      : lower.includes('spam')
        ? 'spam'
        : lower.includes('core')
          ? 'core'
          : 'other';

    // "June 2026 spam update" reads as "Jun 2026 Spam" on a chart that has ~40px per label.
    const name = desc
      .replace(/\s+update$/i, '')
      .replace(/^(\w{3})\w*/, (_m, m3: string) => m3.charAt(0).toUpperCase() + m3.slice(1))
      .replace(/\b(core|spam|discover)\b/i, (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());

    const endIso = (inc.end ?? '').slice(0, 10);
    const hasEnd = /^\d{4}-\d{2}-\d{2}$/.test(endIso) && endIso >= begin;
    const duration = hasEnd
      ? `${Math.max(1, Math.round((Date.parse(endIso) - Date.parse(begin)) / 86_400_000))} days`
      : undefined;

    out.push({ date: begin, end: hasEnd ? endIso : undefined, name, type, duration, ongoing: !hasEnd });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Updates are announced monthly at most, so an hour is already far fresher than the data
// being annotated: Search Console itself lags two to three days.
const TTL_MS = 60 * 60 * 1000;
const FEED = 'https://status.search.google.com/incidents.json';

interface Cache {
  at: number;
  updates: AlgoUpdate[];
  source: 'google' | 'builtin';
}
let cache: Cache | null = null;

export async function getAlgoUpdates(): Promise<{ updates: AlgoUpdate[]; source: 'google' | 'builtin' }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { updates: cache.updates, source: cache.source };
  try {
    const res = await fetch(FEED, {
      headers: { Accept: 'application/json', 'User-Agent': 'gsc-hub' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) throw new Error('unexpected payload');
    const fetched = mapIncidentsToUpdates(raw as GoogleIncident[]);
    // Empty means the feed parsed but nothing matched — a shape change. Treat it as a
    // failure rather than quietly replacing a good list with nothing.
    if (!fetched.length) throw new Error('no ranking updates in feed');
    // Merged, not replaced: the feed reaches back about a year while the built-in list goes
    // to early 2026, and a 16-month Search Console window can span both.
    const seen = new Set(fetched.map((u) => `${u.date}|${u.type}`));
    const merged = [...fetched, ...ALGO_UPDATES.filter((u) => !seen.has(`${u.date}|${u.type}`))].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    cache = { at: Date.now(), updates: merged, source: 'google' };
    return { updates: merged, source: 'google' };
  } catch {
    // Failures are cached too, so an unreachable feed does not cost ten seconds per render.
    cache = { at: Date.now(), updates: ALGO_UPDATES, source: 'builtin' };
    return { updates: ALGO_UPDATES, source: 'builtin' };
  }
}
