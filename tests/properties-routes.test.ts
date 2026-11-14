import { beforeEach, afterEach, expect, it, describe, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => testDb }));
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/lib/server/portfolio', async (original) => ({
  ...await original<typeof import('../src/lib/server/portfolio')>(),
  portfolio: { get }
}));
vi.mock('../src/lib/server/bing', async (original) => ({
  ...await original<typeof import('../src/lib/server/bing')>(),
  getBing: async () => ({ traffic: new Map(), queries: [] }),
  getBingWithin: async () => ({ traffic: new Map(), queries: [] })
}));
import { addHiddenSite } from '../src/lib/server/hidden';
import { load } from '../src/routes/properties/+page.server';
import { slotOf, readyStatus } from './helpers/portfolio-slots';
import { allQueries, topQueries, topPages, topK } from '../src/lib/server/portfolio-top';

const NOW = new Date('2026-11-11T20:00:00Z');
const page = (query = '') => load({ url: new URL(`http://localhost/properties${query}`), locals: { user: { role: 'admin' } } } as any) as Promise<any>;
const urls = (r: any) => r.sites.map((s: any) => s.siteUrl);

function portfolioOf(n: number, clicks = (i: number) => 1) {
  return Array.from({ length: n }, (_, i) => slotOf(`sc-domain:s${String(i).padStart(3, '0')}.com`, [{ date: '2026-11-10', clicks: clicks(i), impressions: 10 }], i % 2 ? 'acc-b' : 'acc-a'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  testDb = openDb(':memory:');
});
afterEach(() => { testDb.close(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('/properties load', () => {
  it('sends one page of 100 rows, in a stable order, with whole-portfolio totals', async () => {
    get.mockResolvedValue({ slots: portfolioOf(250), accountErrors: [], status: readyStatus });
    const seen: string[] = [];
    for (const p of [1, 2, 3]) {
      const r = await page(`?days=7&page=${p}`);
      expect(r.sites.length).toBeLessThanOrEqual(100);
      expect(r).toMatchObject({ page: p, pageCount: 3, total: 250 });
      expect(r.totals).toEqual({ sites: 250, clicks: 250, impressions: 2500 });
      seen.push(...urls(r));
    }
    expect(new Set(seen).size).toBe(250);
    expect(seen).toEqual([...seen].sort());
  });

  it('sorts the whole portfolio before paging', async () => {
    get.mockResolvedValue({ slots: portfolioOf(150, (i) => i), accountErrors: [], status: readyStatus });
    const r = await page('?days=7&sort=clicks&dir=desc');
    expect(r.sites[0].siteUrl).toBe('sc-domain:s149.com');
    expect((await page('?days=7&sort=clicks&dir=desc&page=2')).sites.at(-1).siteUrl).toBe('sc-domain:s000.com');
  });

  it('leaves hidden sites out of the rows and the totals, and lists them on request', async () => {
    get.mockResolvedValue({ slots: portfolioOf(3, (i) => i + 1), accountErrors: [], status: readyStatus });
    addHiddenSite(testDb, 'acc-b', 'sc-domain:s001.com');
    const r = await page('?days=7&sort=site&dir=asc');
    expect(urls(r)).toEqual(['sc-domain:s000.com', 'sc-domain:s002.com']);
    expect(r.totals).toEqual({ sites: 2, clicks: 4, impressions: 20 });
    expect(r.hiddenCount).toBe(1);
    expect(r.perAccount).toEqual([expect.objectContaining({ accountId: 'acc-a', sites: 2, clicks: 4 })]);

    const shown = await page('?days=7&sort=site&dir=asc&hidden=1');
    expect(shown.sites.map((s: any) => [s.siteUrl, s.hidden])).toEqual([
      ['sc-domain:s000.com', false], ['sc-domain:s001.com', true], ['sc-domain:s002.com', false]
    ]);
    // Showing hidden rows does not fold them into the portfolio totals.
    expect(shown.totals).toEqual(r.totals);
  });

  it('filters by search on the server without changing the totals', async () => {
    get.mockResolvedValue({ slots: portfolioOf(20), accountErrors: [], status: readyStatus });
    const r = await page('?days=7&q=s01');
    expect(urls(r)).toHaveLength(10);
    expect(r.total).toBe(10);
    expect(r.totals.sites).toBe(20);
  });

  it('marks unread sites pending and carries the snapshot status', async () => {
    const status = { ...readyStatus, state: 'cold', refreshing: true, done: 0, total: 1, updatedAt: null };
    get.mockResolvedValue({ slots: [slotOf('sc-domain:a.com', null)], accountErrors: [], status });
    const r = await page();
    expect(r.sites[0]).toMatchObject({ summary: null, summaryError: null, pending: true });
    expect(r.status).toEqual(status);
  });
});

describe('top queries and pages', () => {
  const top = (siteUrl: string, accountId: string, queries: any[], pages: any[] = []) => ({
    site: { siteUrl, permissionLevel: 'o', accountId, accountEmail: 'x', accountLabel: null },
    value: { queries, pages }, error: null, fetchedAt: 1
  });
  const q = (query: string, page: string, clicks: number, impressions: number, position: number, country = 'usa') => ({ query, page, country, clicks, impressions, position });
  const params = { sort: 'clicks' as const, dir: 'desc' as const, countries: new Set<string>(), domains: new Set<string>(), source: 'all' as const, posMin: null, posMax: null, showFiltered: false, patterns: [] };

  it('merges duplicate rows across properties, skips hidden sites, and joins Bing by domain', () => {
    const slots = [
      top('sc-domain:a.com', 'x', [q('shoes', 'https://a.com/', 2, 20, 3)]),
      top('https://a.com/', 'y', [q('shoes', 'https://a.com/', 1, 10, 6)]),
      top('sc-domain:b.com', 'x', [q('hats', 'https://b.com/', 5, 50, 1)])
    ];
    const all = allQueries(slots as any, new Set(['x|sc-domain:b.com']), [
      { host: 'a.com', query: 'Shoes', clicks: 4, impressions: 8, position: 2 } as any,
      { host: 'a.com', query: 'boots', clicks: 1, impressions: 2, position: 9 } as any,
      { host: 'b.com', query: 'hats', clicks: 1, impressions: 1, position: 1 } as any
    ]);
    const shoes = all.find((r) => r.query === 'shoes')!;
    expect(shoes.gsc).toMatchObject({ clicks: 3, impressions: 30, position: 4 });
    expect(shoes.bing).toMatchObject({ clicks: 4 });
    expect(all.find((r) => r.query === 'boots')).toMatchObject({ gsc: null, page: '', domain: 'a.com' });
    expect(all.some((r) => r.query === 'hats')).toBe(false);
  });

  it('applies filters to the whole set, returns at most 200 rows, and lists the facets', () => {
    const rows = Array.from({ length: 500 }, (_, i) => q(`k${i}`, `https://a.com/${i}`, i, 1000, (i % 30) + 1, i % 2 ? 'usa' : 'deu'));
    rows.push(q('site:a.com', 'https://a.com/x', 9999, 9999, 1));
    const all = allQueries([top('sc-domain:a.com', 'x', rows)] as any, new Set(), []);
    const r = topQueries(all, rows.length, { ...params, patterns: ['site:'], countries: new Set(['deu']) });
    expect(r.rows).toHaveLength(200);
    expect(r.rows.every((x) => x.country === 'deu')).toBe(true);
    expect(r.rows[0].query).toBe('k498');
    expect(r.filteredCount).toBe(1);
    expect(r.availableCountries).toEqual(['deu', 'usa']);
    const shown = topQueries(all, rows.length, { ...params, showFiltered: true });
    expect(shown.rows[0].query).toBe('site:a.com');
    const ranged = topQueries(all, rows.length, { ...params, posMin: 5, posMax: 6, sort: 'position', dir: 'asc' });
    expect(ranged.rows.every((x) => x.gsc!.position >= 5 && x.gsc!.position <= 6)).toBe(true);
  });

  it('aggregates pages by URL across visible sites', () => {
    const p = (page: string, clicks: number) => ({ page, clicks, impressions: clicks * 10, position: 2 });
    const r = topPages([
      top('sc-domain:a.com', 'x', [], [p('https://a.com/1', 5), p('https://a.com/2', 1)]),
      top('https://a.com/', 'y', [], [p('https://a.com/1', 2)])
    ] as any, new Set(), 'clicks', 'desc');
    expect(r.rows.map((x) => [x.page, x.clicks])).toEqual([['https://a.com/1', 7], ['https://a.com/2', 1]]);
    expect(r.sourceRows).toBe(3);
  });

  it('selects the top k exactly like a full sort', () => {
    const items = Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5003);
    const cmp = (a: number, b: number) => b - a;
    expect(topK(items, cmp, 200)).toEqual([...items].sort(cmp).slice(0, 200));
  });
});

describe('rows per site and "show more"', () => {
  it('scales the automatic query-row limit with the portfolio', async () => {
    const { autoRows } = await import('../src/lib/server/portfolio-settings');
    expect(autoRows('queries', 87)).toBe(1000);
    expect(autoRows('queries', 5000)).toBe(500);
    expect(autoRows('queries', 10_000)).toBe(250);
    expect(autoRows('queries', 50_000)).toBe(250);
    expect(autoRows('pages', 87)).toBe(200);
  });

  it('pins a value in settings, rejects nonsense, and goes back to auto on empty', async () => {
    const { saveTopRows, topRowsSetting } = await import('../src/lib/server/portfolio-settings');
    expect(topRowsSetting(testDb, 'queries', 87)).toMatchObject({ pinned: null, effective: 1000 });
    saveTopRows(testDb, 'queries', '3000');
    expect(topRowsSetting(testDb, 'queries', 87)).toMatchObject({ pinned: 3000, effective: 3000, auto: 1000 });
    expect(() => saveTopRows(testDb, 'queries', '30000')).toThrow();
    expect(() => saveTopRows(testDb, 'queries', '1.5')).toThrow();
    saveTopRows(testDb, 'queries', '');
    expect(topRowsSetting(testDb, 'queries', 87).pinned).toBeNull();
  });

  it('returns a longer slice of the same order, and says how many rows match', () => {
    const q = (i: number) => ({ query: `k${i}`, page: `https://a.com/${i}`, country: 'usa', clicks: i, impressions: 100, position: 3 });
    const slot = { site: { siteUrl: 'sc-domain:a.com', permissionLevel: 'o', accountId: 'x', accountEmail: 'x', accountLabel: null }, value: { queries: Array.from({ length: 700 }, (_, i) => q(i)), pages: [] }, error: null, fetchedAt: 1 };
    const all = allQueries([slot] as any, new Set(), []);
    const params = { sort: 'clicks' as const, dir: 'desc' as const, countries: new Set<string>(), domains: new Set<string>(), source: 'all' as const, posMin: null, posMax: null, showFiltered: false, patterns: [] };
    const first = topQueries(all, 700, params);
    const more = topQueries(all, 700, params, 400);
    expect(first.matched).toBe(700);
    expect(first.rows).toHaveLength(200);
    expect(more.rows).toHaveLength(400);
    expect(more.rows.slice(0, 200)).toEqual(first.rows);
    expect(topQueries(all, 700, params, 10 ** 9).rows).toHaveLength(700);
  });
});
