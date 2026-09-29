import { describe, it, expect } from 'vitest';
import { mapIncidentsToUpdates, updatesForChart } from '../src/lib/server/algo-updates';

const series = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
  clicks: 100,
  impressions: 1000
}));

describe('ongoing rollouts', () => {
  it('marks a feed incident without an end as ongoing', () => {
    const [u] = mapIncidentsToUpdates([
      { begin: '2026-09-24T16:15:00+00:00', status_impact: 'SERVICE_INFORMATION', external_desc: 'September 2026 spam update' }
    ] as never);
    expect(u).toMatchObject({ date: '2026-09-24', name: 'Sep 2026 Spam', type: 'spam', ongoing: true });
    expect(u.end).toBeUndefined();
  });

  it('keeps finished incidents not ongoing', () => {
    const [u] = mapIncidentsToUpdates([
      { begin: '2026-08-18T16:27:00+00:00', end: '2026-08-21T08:49:00+00:00', status_impact: 'SERVICE_INFORMATION', external_desc: 'August 2026 spam update' }
    ] as never);
    expect(u.ongoing).toBe(false);
    expect(u.end).toBe('2026-08-21');
  });

  it('shades an ongoing rollout to the last day of data and gives no impact yet', () => {
    const [band] = updatesForChart(
      [{ date: '2026-09-20', name: 'Sep 2026 Spam', type: 'spam', ongoing: true }],
      series
    );
    expect(band.date).toBe('2026-09-20');
    expect(band.end).toBe('2026-09-30');
    expect(band.ongoing).toBe(true);
    expect(band.impact).toBeNull();
  });

  it('does not draw an ongoing rollout that starts after the data ends', () => {
    const bands = updatesForChart(
      [{ date: '2026-10-05', name: 'Oct 2026 Spam', type: 'spam', ongoing: true }],
      series
    );
    expect(bands).toEqual([]);
  });
});
