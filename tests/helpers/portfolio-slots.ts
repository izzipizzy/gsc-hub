// Builds portfolio-snapshot slots for route tests, without Search Console.
import { SERIES_DAYS, type DailySeries } from '../../src/lib/server/portfolio';
import { addCalendarDays, dateSpan, gscToday } from '../../src/lib/server/gsc-calendar';
import type { SiteSlot, RefreshStatus } from '../../src/lib/server/portfolio-store';

export interface DayRow { date: string; clicks: number; impressions: number; position?: number }

export function seriesOf(rows: DayRow[], now = Date.now()): DailySeries {
  const start = addCalendarDays(gscToday(now), -(SERIES_DAYS - 1));
  const s: DailySeries = {
    start,
    clicks: new Int32Array(SERIES_DAYS),
    impressions: new Int32Array(SERIES_DAYS),
    position: new Float32Array(SERIES_DAYS)
  };
  for (const r of rows) {
    const i = dateSpan(start, r.date) - 1;
    s.clicks[i] = r.clicks;
    s.impressions[i] = r.impressions;
    s.position[i] = r.position ?? 5;
  }
  return s;
}

export function slotOf(siteUrl: string, rows: DayRow[] | null, accountId = 'account', error: string | null = null): SiteSlot<DailySeries> {
  return {
    site: { siteUrl, permissionLevel: 'siteOwner', accountId, accountEmail: `${accountId}@x`, accountLabel: null },
    value: rows ? seriesOf(rows) : null,
    error,
    fetchedAt: rows ? Date.now() : null
  };
}

export const readyStatus: RefreshStatus = {
  state: 'ready', refreshing: false, done: 0, total: 0, startedAt: 1, updatedAt: 1, error: null
};
