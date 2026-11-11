import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => testDb }));
const { daily } = vi.hoisted(() => ({ daily: vi.fn() }));
vi.mock('../src/lib/server/google', () => ({ fetchDailyBreakdown: daily }));
import { addSiteEvent } from '../src/lib/server/site-events';
import { load } from '../src/routes/dashboard/+page.server';

const entries = [
  { siteUrl: 'sc-domain:beta.com', clicks: 20, impressions: 100 },
  { siteUrl: 'https://Alpha.com/path/', clicks: 10, impressions: 200 },
  { siteUrl: 'http://zeta.org/', clicks: 30, impressions: 50 }
].map(({ siteUrl, clicks, impressions }) => ({
  siteUrl, accountId: 'account', current: [{ date: '2026-11-08' }, { date: '2026-11-10' }], currentTotals: { clicks, impressions }
}));
const page = (query = '', role = 'admin') => load({
  url: new URL(`http://localhost/dashboard${query}`), locals: { user: { role } }
} as any) as Promise<any>;

beforeEach(() => {
  testDb = openDb(':memory:');
  daily.mockResolvedValue({ entries, errors: [], comparable: true });
});
afterEach(() => { testDb.close(); vi.clearAllMocks(); });

it.each(['asc', 'desc'])('sorts by displayed domain in %s order regardless of GSC prefix or metrics', async (dir) => {
  const result = await page(`?sort=site&dir=${dir}&q=.com&days=7&cols=6`);
  const expected = [entries[1], entries[0], entries[2]].map((e) => e.siteUrl);
  expect(result.entries.map((e: any) => e.siteUrl)).toEqual(dir === 'asc' ? expected : expected.reverse());
  expect(result).toMatchObject({ days: 7, cols: 6, sort: 'site', dir });
  expect(entries[0].siteUrl).toBe('sc-domain:beta.com');
});

it('keeps existing metric sorts and rejects unknown sort fields', async () => {
  for (const query of ['', '?sort=invalid', '?sort=clicks&dir=desc']) {
    expect((await page(query)).entries.map((e: any) => e.siteUrl)).toEqual([entries[2], entries[0], entries[1]].map((e) => e.siteUrl));
  }
  expect((await page('?sort=impressions&dir=asc')).entries.map((e: any) => e.siteUrl)).toEqual([entries[2], entries[0], entries[1]].map((e) => e.siteUrl));
});

it('continues to require an administrator', async () => {
  await expect(page('', 'manager')).rejects.toMatchObject({ status: 403 });
  expect(daily).not.toHaveBeenCalled();
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
