// The portfolio snapshot behind /dashboard and /properties: one daily series
// per site, from which every date-based view is derived.
//
// /dashboard (current + previous period), Today, the /properties summaries and
// the portfolio pulse all asked Search Console the same question — clicks and
// impressions by date for one site — over different windows: five requests per
// site per hour. One request for the whole history Search Console keeps answers
// all of them, so a pass over the portfolio costs one request per site.
//
// Stored compactly (three typed arrays of 481 days, ~6 KB per site, ~60 MB for
// 10,000 sites): the raw rows as objects would be several times that.

import type { Db } from './db';
import type { AccountRow } from './accounts';
import {
  GSC_HISTORY_DAYS,
  canCompare,
  searchAnalyticsUncached,
  totalsOf,
  type DailyRow,
  type PeriodTotals,
  type SiteRow
} from './google';
import { addCalendarDays, completedDayRange, dateSpan, gscToday } from './gsc-calendar';
import { PortfolioStore, type AccountError, type RefreshStatus, type SiteSlot } from './portfolio-store';

/** Today plus GSC_HISTORY_DAYS completed days — every window the pages offer. */
export const SERIES_DAYS = GSC_HISTORY_DAYS + 1;

export interface DailySeries {
  /** Date of index 0 (YYYY-MM-DD, Search Console's timezone). */
  start: string;
  clicks: Int32Array;
  impressions: Int32Array;
  position: Float32Array;
}

export async function fetchSeries(db: Db, acc: AccountRow, site: SiteRow, now = Date.now()): Promise<DailySeries> {
  const end = gscToday(now);
  const start = addCalendarDays(end, -(SERIES_DAYS - 1));
  const rows = await searchAnalyticsUncached(db, acc, site.siteUrl, {
    startDate: start,
    endDate: end,
    dimensions: ['date'],
    rowLimit: 1000,
    dataState: 'all'
  });
  const series: DailySeries = {
    start,
    clicks: new Int32Array(SERIES_DAYS),
    impressions: new Int32Array(SERIES_DAYS),
    position: new Float32Array(SERIES_DAYS)
  };
  for (const r of rows) {
    const date = r.keys[0];
    if (!date) continue;
    const i = dateSpan(start, date) - 1;
    if (i < 0 || i >= SERIES_DAYS) continue;
    series.clicks[i] = r.clicks;
    series.impressions[i] = r.impressions;
    series.position[i] = r.position;
  }
  return series;
}

export const portfolio = new PortfolioStore<DailySeries>((db, acc, site) => fetchSeries(db, acc, site));

/**
 * Days of `series` inside [from, to], as Search Console would return them for
 * that window: only dates with impressions, oldest first.
 */
export function rowsBetween(series: DailySeries | null, from: string, to: string): DailyRow[] {
  if (!series) return [];
  const out: DailyRow[] = [];
  const lo = Math.max(0, dateSpan(series.start, from) - 1);
  const hi = Math.min(SERIES_DAYS - 1, dateSpan(series.start, to) - 1);
  for (let i = lo; i <= hi; i++) {
    const impressions = series.impressions[i];
    if (impressions <= 0) continue;
    const clicks = series.clicks[i];
    out.push({
      date: addCalendarDays(series.start, i),
      clicks,
      impressions,
      ctr: clicks / impressions,
      position: series.position[i]
    });
  }
  return out;
}

/** Totals over [from, to] without materialising the rows — for sorting everything. */
export function totalsBetween(series: DailySeries | null, from: string, to: string): PeriodTotals {
  let clicks = 0, impressions = 0, posWeightedSum = 0;
  if (series) {
    const lo = Math.max(0, dateSpan(series.start, from) - 1);
    const hi = Math.min(SERIES_DAYS - 1, dateSpan(series.start, to) - 1);
    for (let i = lo; i <= hi; i++) {
      clicks += series.clicks[i];
      impressions += series.impressions[i];
      posWeightedSum += series.position[i] * series.impressions[i];
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeightedSum / impressions : 0
  };
}

/** Status shape the pages render; dates as epoch ms. */
export type SnapshotStatus = RefreshStatus;

export interface BreakdownEntry {
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  siteUrl: string;
  current: DailyRow[];
  previous: DailyRow[];
  currentTotals: PeriodTotals;
  previousTotals: PeriodTotals;
  error: string | null;
  /** Not fetched yet in this process — no numbers, not zero numbers. */
  pending: boolean;
}

/** /dashboard: current window of `days` completed days, and the one before it. */
export function breakdownOf(slot: SiteSlot<DailySeries>, days: number, now = Date.now()): BreakdownEntry {
  const { startDate, endDate } = completedDayRange(days, now);
  const comparable = canCompare(days);
  const prevEnd = addCalendarDays(startDate, -1);
  const prevStart = addCalendarDays(prevEnd, -(days - 1));
  const current = rowsBetween(slot.value, startDate, endDate);
  const previous = comparable ? rowsBetween(slot.value, prevStart, prevEnd) : [];
  return {
    accountId: slot.site.accountId,
    accountEmail: slot.site.accountEmail,
    accountLabel: slot.site.accountLabel,
    siteUrl: slot.site.siteUrl,
    current,
    previous,
    currentTotals: totalsOf(current),
    previousTotals: totalsOf(previous),
    // A site with an older answer still shows it; the failure is only news
    // when there is nothing to show.
    error: slot.value === null ? slot.error : null,
    pending: slot.value === null && slot.error === null
  };
}

export interface SummaryOf {
  summary: { clicks: number; impressions: number; ctr: number; position: number; series: number[] } | null;
  summaryError: string | null;
  pending: boolean;
}

/** /properties: totals over `days` completed days plus the daily-clicks sparkline. */
export function summaryOf(slot: SiteSlot<DailySeries>, days: number, now = Date.now()): SummaryOf {
  if (slot.value === null) return { summary: null, summaryError: slot.error, pending: slot.error === null };
  const { startDate, endDate } = completedDayRange(days, now);
  const rows = rowsBetween(slot.value, startDate, endDate);
  const t = totalsOf(rows);
  return {
    summary: { ...t, series: rows.map((r) => r.clicks) },
    summaryError: null,
    pending: false
  };
}

export interface TodaySnapshot {
  date: string;
  totals: PeriodTotals;
  errors: AccountError[];
  partial: boolean;
  status: RefreshStatus;
}

/** Today so far, summed over every site. Partial while a site is unread. */
export function todayOf(slots: SiteSlot<DailySeries>[], accountErrors: AccountError[], status: RefreshStatus, now = Date.now()): TodaySnapshot {
  const date = gscToday(now);
  const rows: DailyRow[] = [];
  const errors = [...accountErrors];
  let missing = 0;
  for (const slot of slots) {
    if (slot.value === null) {
      missing++;
      if (slot.error) errors.push({ accountId: slot.site.accountId, accountEmail: slot.site.accountEmail, reason: `${slot.site.siteUrl}: ${slot.error.slice(0, 100)}` });
      continue;
    }
    rows.push(...rowsBetween(slot.value, date, date));
  }
  return { date, totals: totalsOf(rows), errors, partial: errors.length > 0 || missing > 0, status };
}

/** Portfolio pulse: clicks and impressions by date over `days`, summed across sites. */
export function pulseOf(slots: SiteSlot<DailySeries>[], days: number, hidden: Set<string>, now = Date.now()) {
  const { startDate } = completedDayRange(days, now);
  // Summed on a day axis with typed arrays: at 10,000 sites × 480 days, a row
  // object per site-day took seconds.
  const clicksByDay = new Float64Array(days);
  const imprByDay = new Float64Array(days);
  const seen = new Uint8Array(days);
  const siteUrls: string[] = [];
  for (const slot of slots) {
    if (hidden.has(`${slot.site.accountId}|${slot.site.siteUrl}`)) continue;
    siteUrls.push(slot.site.siteUrl);
    const s = slot.value;
    if (!s) continue;
    // Index in the series of the window's first day; the window runs `days` long.
    const offset = dateSpan(s.start, startDate) - 1;
    for (let d = 0; d < days; d++) {
      const i = offset + d;
      if (i < 0 || i >= SERIES_DAYS) continue;
      const impr = s.impressions[i];
      if (impr <= 0) continue;
      clicksByDay[d] += s.clicks[i];
      imprByDay[d] += impr;
      seen[d] = 1;
    }
  }
  const series: { date: string; clicks: number; impressions: number }[] = [];
  let clicks = 0, impressions = 0;
  for (let d = 0; d < days; d++) {
    if (!seen[d]) continue;
    series.push({ date: addCalendarDays(startDate, d), clicks: clicksByDay[d], impressions: imprByDay[d] });
    clicks += clicksByDay[d];
    impressions += imprByDay[d];
  }
  return {
    totals: { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 },
    series,
    siteUrls
  };
}
