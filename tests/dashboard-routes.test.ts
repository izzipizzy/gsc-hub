import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => testDb }));
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/lib/server/portfolio', async (original) => ({
  ...await original<typeof import('../src/lib/server/portfolio')>(),
  portfolio: { get }
}));
import { addSiteEvent } from '../src/lib/server/site-events';
import { addHiddenSite } from '../src/lib/server/hidden';
import { load } from '../src/routes/dashboard/+page.server';
import { slotOf, readyStatus } from './helpers/portfolio-slots';

// Pacific 2026-11-11, so the last completed day is the 10th.
const NOW = new Date('2026-11-11T20:00:00Z');

const sites = [
  { siteUrl: 'sc-domain:beta.com', clicks: 20, impressions: 100 },
  { siteUrl: 'https://Alpha.com/path/', clicks: 10, impressions: 200 },
  { siteUrl: 'http://zeta.org/', clicks: 30, impressions: 50 }
];
const slots = () => sites.map(({ siteUrl, clicks, impressions }) => slotOf(siteUrl, [
  { date: '2026-11-08', clicks: clicks / 2, impressions: impressions / 2 },
  { date: '2026-11-10', clicks: clicks / 2, impressions: impressions / 2 }
]));
const page = (query = '', role = 'admin', favs?: string[]) => load({
  url: new URL(`http://localhost/dashboard${query}`),
  locals: { user: { role } },
  cookies: { get: () => (favs ? JSON.stringify(favs) : undefined) }
} as any) as Promise<any>;
const urls = (r: any) => r.entries.map((e: any) => e.siteUrl);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  testDb = openDb(':memory:');
  get.mockImplementation(async () => ({ slots: slots(), accountErrors: [], status: readyStatus }));
});
afterEach(() => { testDb.close(); vi.clearAllMocks(); vi.useRealTimers(); });

it.each(['asc', 'desc'])('sorts by displayed domain in %s order and filters by search on the server', async (dir) => {
  const result = await page(`?sort=site&dir=${dir}&q=.com&days=7&cols=6`);
  const expected = [sites[1], sites[0]].map((e) => e.siteUrl);
  expect(urls(result)).toEqual(dir === 'asc' ? expected : expected.reverse());
  expect(result).toMatchObject({ days: 7, cols: 6, sort: 'site', dir, q: '.com', total: 2 });
});

it('keeps existing metric sorts and rejects unknown sort fields', async () => {
  for (const query of ['', '?sort=invalid', '?sort=clicks&dir=desc']) {
    expect(urls(await page(query))).toEqual([sites[2], sites[0], sites[1]].map((e) => e.siteUrl));
  }
  expect(urls(await page('?sort=impressions&dir=asc'))).toEqual([sites[2], sites[0], sites[1]].map((e) => e.siteUrl));
});

it('continues to require an administrator', async () => {
  await expect(page('', 'manager')).rejects.toMatchObject({ status: 403 });
  expect(get).not.toHaveBeenCalled();
});

it('only includes events for the card host and current calendar window', async () => {
  addSiteEvent(testDb, { siteHost: 'beta.com', date: '2026-11-09', type: 'custom', note: 'Переезд в подпапку' });
  addSiteEvent(testDb, { siteHost: 'beta.com', date: '2026-11-07', type: 'custom', note: 'Outside' });
  addSiteEvent(testDb, { siteHost: 'other.com', date: '2026-11-09', type: 'custom', note: 'Other site' });
  const result = await page();
  expect(result.entries.find((e: any) => e.siteUrl === 'sc-domain:beta.com').events)
    .toEqual([expect.objectContaining({ date: '2026-11-09', label: 'Переезд в подпапку' })]);
  expect(result.entries.find((e: any) => e.siteUrl === 'http://zeta.org/').events).toEqual([]);
});

it('derives current and previous periods from the one series', async () => {
  get.mockResolvedValue({
    slots: [slotOf('sc-domain:a.com', [
      { date: '2026-11-03', clicks: 2, impressions: 20 },  // previous 7-day window
      { date: '2026-11-04', clicks: 3, impressions: 30 },  // current starts here
      { date: '2026-11-10', clicks: 7, impressions: 70 },
      { date: '2026-11-11', clicks: 9, impressions: 90 }   // today: in neither
    ])],
    accountErrors: [],
    status: readyStatus
  });
  const [e] = (await page('?days=7')).entries;
  expect(e.current.map((r: any) => r.date)).toEqual(['2026-11-04', '2026-11-10']);
  expect(e.currentTotals).toMatchObject({ clicks: 10, impressions: 100 });
  expect(e.previous.map((r: any) => r.date)).toEqual(['2026-11-03']);
  expect(e.previousTotals.clicks).toBe(2);
});

it('pages 100 cards at a time in a stable order with no gaps or repeats', async () => {
  // 250 sites with identical metrics: only the tie-break decides the order.
  get.mockResolvedValue({
    slots: Array.from({ length: 250 }, (_, i) => slotOf(`sc-domain:s${String(i).padStart(3, '0')}.com`, [{ date: '2026-11-10', clicks: 1, impressions: 10 }])),
    accountErrors: [],
    status: readyStatus
  });
  const seen: string[] = [];
  for (const p of [1, 2, 3]) {
    const r = await page(`?page=${p}`);
    expect(r.entries.length).toBeLessThanOrEqual(100);
    expect(r).toMatchObject({ page: p, pageCount: 3, total: 250 });
    seen.push(...urls(r));
  }
  expect(seen).toHaveLength(250);
  expect(new Set(seen).size).toBe(250);
  expect(urls(await page('?page=2'))).toEqual(seen.slice(100, 200));
  // Past the end lands on the last page, not on an empty one.
  expect((await page('?page=9')).page).toBe(3);
});

it('sorts the whole portfolio before paging', async () => {
  get.mockResolvedValue({
    slots: Array.from({ length: 150 }, (_, i) => slotOf(`sc-domain:s${i}.com`, [{ date: '2026-11-10', clicks: i, impressions: 10 }])),
    accountErrors: [],
    status: readyStatus
  });
  const first = await page('?sort=clicks&dir=desc');
  expect(first.entries[0].siteUrl).toBe('sc-domain:s149.com');
  const last = await page('?sort=clicks&dir=desc&page=2');
  expect(last.entries.at(-1).siteUrl).toBe('sc-domain:s0.com');
});

it('puts favorites first and hidden sites last, with whole-portfolio counts', async () => {
  addHiddenSite(testDb, 'account', 'http://zeta.org/');
  const r = await page('', 'admin', ['account|https://Alpha.com/path/']);
  expect(r.entries.map((e: any) => [e.siteUrl, e.group])).toEqual([
    ['https://Alpha.com/path/', 'fav'],
    ['sc-domain:beta.com', 'rest'],
    ['http://zeta.org/', 'hidden']
  ]);
  expect(r.counts).toEqual({ fav: 1, rest: 1, hidden: 1 });
});

it('marks sites not fetched yet as pending and passes the snapshot status through', async () => {
  const status = { ...readyStatus, state: 'cold', refreshing: true, done: 1, total: 2, updatedAt: null };
  get.mockResolvedValue({ slots: [slotOf('sc-domain:a.com', null)], accountErrors: [], status });
  const r = await page();
  expect(r.entries[0]).toMatchObject({ pending: true, error: null });
  expect(r.status).toEqual(status);
  expect(get).toHaveBeenCalledWith(testDb, { wait: false });
});
