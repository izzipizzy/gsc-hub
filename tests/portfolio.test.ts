import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { upsertAccount, markRevoked } from '../src/lib/server/accounts';
import { PortfolioStore } from '../src/lib/server/portfolio-store';
import { fetchSeries, rowsBetween, totalsBetween, todayOf, pulseOf, summaryOf, breakdownOf, SERIES_DAYS } from '../src/lib/server/portfolio';
import { slotOf, readyStatus } from './helpers/portfolio-slots';

const SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const future = () => Math.floor(Date.now() / 1000) + 3600;

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertAccount(db, { id: 'a1', email: 'a1@x', access_token: 't', refresh_token: 'r', expires_at: future(), scope: 's' });
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubSites(siteUrls: string[] | (() => string[])) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === SITES_URL) {
      const list = typeof siteUrls === 'function' ? siteUrls() : siteUrls;
      return new Response(JSON.stringify({ siteEntry: list.map((siteUrl) => ({ siteUrl, permissionLevel: 'siteOwner' })) }));
    }
    throw new Error(`unexpected ${url}`);
  }));
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('PortfolioStore', () => {
  it('runs one pass however many readers arrive while it runs', async () => {
    stubSites(['https://a.com/', 'https://b.com/']);
    const gate = deferred<void>();
    const fetchSite = vi.fn(async (_db: Db, _acc: unknown, site: { siteUrl: string }) => (await gate.promise, site.siteUrl.length));
    const store = new PortfolioStore(fetchSite, { coldWaitMs: 5 });
    const views = await Promise.all([1, 2, 3, 4, 5].map(() => store.get(db, { wait: false })));
    for (const v of views) expect(v.status).toMatchObject({ state: 'cold', refreshing: true });
    gate.resolve();
    await store.settled();
    expect(fetchSite).toHaveBeenCalledTimes(2);
    const v = await store.get(db, { wait: false });
    expect(v.status).toMatchObject({ state: 'ready', refreshing: false, done: 2, total: 2 });
    expect(v.slots.map((s) => s.value)).toEqual([14, 14]);
  });

  it('answers a cold read within coldWaitMs with progress instead of waiting for the pass', async () => {
    stubSites(['https://a.com/', 'https://b.com/']);
    const gate = deferred<void>();
    const store = new PortfolioStore(async (_d, _a, site) => {
      if (site.siteUrl === 'https://b.com/') await gate.promise;
      return 1;
    }, { coldWaitMs: 20 });
    const t0 = Date.now();
    const v = await store.get(db, { wait: false });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(v.status).toMatchObject({ state: 'cold', refreshing: true, done: 1, total: 2 });
    // The finished site is already readable; the other is still pending.
    expect(v.slots.map((s) => s.value)).toEqual([1, null]);
    gate.resolve();
    await store.settled();
  });

  it('serves the previous values while a stale store refreshes, and starts only one refresh', async () => {
    stubSites(['https://a.com/']);
    let now = 0;
    let n = 0;
    let gate: ReturnType<typeof deferred<void>> | null = null;
    const fetchSite = vi.fn(async () => {
      if (gate) await gate.promise;
      return ++n;
    });
    const store = new PortfolioStore(fetchSite, { ttlMs: 1000, now: () => now });
    await store.get(db, { wait: true });
    expect((await store.get(db, { wait: false })).slots[0].value).toBe(1);

    now = 1000; // expired
    gate = deferred<void>();
    const during = await Promise.all([store.get(db, { wait: false }), store.get(db, { wait: false })]);
    for (const v of during) {
      expect(v.slots[0].value).toBe(1);
      expect(v.status).toMatchObject({ state: 'ready', refreshing: true });
    }
    gate.resolve();
    await store.settled();
    expect(fetchSite).toHaveBeenCalledTimes(2);
    expect((await store.get(db, { wait: false })).slots[0].value).toBe(2);
  });

  it('keeps the last good value when a site fails, and reports the error only without one', async () => {
    stubSites(['https://a.com/', 'https://b.com/']);
    let fail = false;
    const store = new PortfolioStore(async (_d, _a, site) => {
      if (fail || site.siteUrl === 'https://b.com/') throw new Error('searchAnalytics 500');
      return 7;
    });
    await store.get(db, { wait: true });
    fail = true;
    store.invalidate();
    await store.get(db, { wait: false });
    await store.settled();
    const v = await store.get(db, { wait: false });
    const [a, b] = v.slots;
    expect(a).toMatchObject({ value: 7, error: 'searchAnalytics 500' });
    expect(b).toMatchObject({ value: null, error: 'searchAnalytics 500' });
    expect(summaryOf(slotOf('https://b.com/', null, 'a1', 'searchAnalytics 500'), 7)).toMatchObject({ summary: null, summaryError: 'searchAnalytics 500', pending: false });
  });

  it('ends a cold pass that cannot list any site in a definite error state, and retries later', async () => {
    let now = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('backend error', { status: 500 })));
    const store = new PortfolioStore(async () => 1, { now: () => now, errorRetryMs: 60_000 });
    const v = await store.get(db, { wait: true });
    expect(v.status).toMatchObject({ state: 'cold', refreshing: false });
    expect(v.status.error).toMatch(/sites\.list 500/);
    expect(v.accountErrors).toHaveLength(1);

    // Not retried on every read…
    const calls = (fetch as any).mock.calls.length;
    await store.get(db, { wait: false });
    expect((fetch as any).mock.calls.length).toBe(calls);
    // …but after the retry interval.
    now = 60_000;
    stubSites(['https://a.com/']);
    const after = await store.get(db, { wait: true });
    expect(after.status).toMatchObject({ state: 'ready', error: null });
  });

  it('hides sites of an account that is no longer active without waiting for a pass', async () => {
    stubSites(['https://a.com/']);
    const store = new PortfolioStore(async () => 1);
    await store.get(db, { wait: true });
    markRevoked(db, 'a1', 'test');
    expect((await store.get(db, { wait: false })).slots).toEqual([]);
  });

  it('runs one more pass when invalidated during a pass', async () => {
    stubSites(['https://a.com/']);
    const gate = deferred<void>();
    let calls = 0;
    const store = new PortfolioStore(async () => {
      calls++;
      if (calls === 1) await gate.promise;
      return calls;
    });
    void store.get(db, { wait: false });
    await new Promise((r) => setTimeout(r, 0));
    store.invalidate();
    gate.resolve();
    await store.settled();
    expect(calls).toBe(2);
  });
});

describe('date series', () => {
  it('asks for today plus 480 days in one request and places rows by date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ rows: [
        { keys: ['2026-11-10'], clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
        { keys: ['2026-11-11'], clicks: 1, impressions: 5, ctr: 0.2, position: 2 }
      ] }));
    }));
    const acc = { id: 'a1', email: 'a1@x', access_token: 't', refresh_token: 'r', expires_at: future(), scope: 's', label: null, status: 'active' } as any;
    const s = await fetchSeries(db, acc, slotOf('https://a.com/', null).site);
    expect(bodies).toEqual([expect.objectContaining({ startDate: '2025-07-19', endDate: '2026-11-11', dimensions: ['date'], dataState: 'all' })]);
    expect(s.impressions.length).toBe(SERIES_DAYS);
    expect(rowsBetween(s, '2026-11-10', '2026-11-11')).toEqual([
      { date: '2026-11-10', clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
      { date: '2026-11-11', clicks: 1, impressions: 5, ctr: 0.2, position: 2 }
    ]);
    expect(totalsBetween(s, '2026-11-01', '2026-11-11')).toMatchObject({ clicks: 4, impressions: 35 });
  });

  it('sums today across sites, partial while any site is unread', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
    const slots = [
      slotOf('https://a.com/', [{ date: '2026-11-11', clicks: 2, impressions: 20 }, { date: '2026-11-10', clicks: 9, impressions: 90 }]),
      slotOf('https://b.com/', [{ date: '2026-11-11', clicks: 3, impressions: 30 }])
    ];
    const t = todayOf(slots, [], readyStatus);
    expect(t).toMatchObject({ date: '2026-11-11', partial: false, totals: { clicks: 5, impressions: 50 } });
    expect(todayOf([...slots, slotOf('https://c.com/', null)], [], readyStatus).partial).toBe(true);
  });

  it('builds the pulse from visible sites only', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
    const slots = [
      slotOf('https://a.com/', [{ date: '2026-11-10', clicks: 2, impressions: 20 }]),
      slotOf('https://b.com/', [{ date: '2026-11-10', clicks: 3, impressions: 30 }])
    ];
    const p = pulseOf(slots, 7, new Set(['account|https://b.com/']));
    expect(p.series).toEqual([{ date: '2026-11-10', clicks: 2, impressions: 20 }]);
    expect(p.siteUrls).toEqual(['https://a.com/']);
  });

  // Pacific is still 2026-08-22 at 03:00 UTC on the 23rd.
  const PACIFIC_EVENING = new Date('2026-08-23T03:00:00Z');
  const every = (from: string, n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10), clicks: 1, impressions: 1 }));

  it('compares two equal, adjacent windows of completed Pacific days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PACIFIC_EVENING);
    const e = breakdownOf(slotOf('https://a.com/', every('2026-07-01', 60)), 7);
    expect(e.current.map((r) => r.date)).toEqual(every('2026-08-15', 7).map((r) => r.date));
    expect(e.previous.map((r) => r.date)).toEqual(every('2026-08-08', 7).map((r) => r.date));
    expect(summaryOf(slotOf('https://a.com/', every('2026-07-01', 60)), 7).summary?.series).toHaveLength(7);
  });

  it('leaves the previous period empty when history cannot reach it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PACIFIC_EVENING);
    const slot = slotOf('https://a.com/', every('2026-01-01', 234));
    expect(breakdownOf(slot, 300).previous).toEqual([]);
    expect(breakdownOf(slot, 28).previous).toHaveLength(28);
  });

  it('takes today in the Pacific timezone, not UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PACIFIC_EVENING);
    const t = todayOf([slotOf('https://a.com/', [{ date: '2026-08-22', clicks: 4, impressions: 9 }, { date: '2026-08-23', clicks: 99, impressions: 99 }])], [], readyStatus);
    expect(t).toMatchObject({ date: '2026-08-22', totals: { clicks: 4 } });
  });

  it('is partial when a whole account cannot be read', () => {
    const t = todayOf([], [{ accountId: 'a', accountEmail: 'a@x', reason: 'sites.list 500' }], readyStatus);
    expect(t.partial).toBe(true);
  });
});

describe('top pass row limits', () => {
  it('asks Search Console for the limit that fits the portfolio', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === SITES_URL) return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'o' }] }));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ rows: [] }));
    }));
    const { topStore } = await import('../src/lib/server/portfolio-top');
    const { saveTopRows } = await import('../src/lib/server/portfolio-settings');
    const store = topStore(7);
    await store.get(db, { wait: true });
    expect(bodies.map((b) => [b.dimensions.join(','), b.rowLimit]).sort()).toEqual([['page', 200], ['query,page,country', 1000]]);
    saveTopRows(db, 'queries', '4000');
    bodies.length = 0;
    store.invalidate();
    await store.get(db, { wait: false });
    await store.settled();
    expect(bodies.find((b) => b.dimensions.length === 3).rowLimit).toBe(4000);
    store.reset();
  });
});
