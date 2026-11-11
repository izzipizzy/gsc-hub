import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { getSiteViewSettings, saveSiteViewSettings } from '../src/lib/server/site-view-settings';
let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => testDb }));
vi.mock('../src/lib/server/accounts', () => ({ getAccount: () => ({ id: 'account', email: 'test@example.com', label: null }) }));
const { daily, bindings, positions } = vi.hoisted(() => ({ daily: vi.fn(), bindings: vi.fn(), positions: vi.fn() }));
vi.mock('../src/lib/server/google', () => ({ fetchSiteDaily: daily }));
vi.mock('../src/lib/server/algo-updates', () => ({ getAlgoUpdates: async () => ({ updates: [], source: 'builtin' }), updatesForChart: () => [] }));
vi.mock('../src/lib/server/serp-monitor', () => ({ fetchBindings: bindings, fetchPositions: positions, requestCheck: vi.fn() }));
import { load } from '../src/routes/properties/[site]/+page.server';
import { GET } from '../src/routes/properties/[site]/serp/+server';
import { addSiteEvent } from '../src/lib/server/site-events';
import { POST } from '../src/routes/properties/[site]/view-settings/+server';
const site = 'https://example.com/';
const locals = { user: { role: 'admin' } };
beforeEach(() => {
  testDb = openDb(':memory:');
  daily.mockResolvedValue({ series: [] });
  bindings.mockResolvedValue({ state: 'ok', bindings: [{ geo: 'fr' }, { geo: 'es' }] });
  positions.mockResolvedValue({ state: 'ok', positions: { rows: [] } });
});
afterEach(() => { testDb.close(); vi.clearAllMocks(); });

it('restores a saved period when re-entering and gives explicit dates precedence', async () => {
  const page = (query: string) => load({ params: { site }, locals, url: new URL('http://localhost/?acc=account'+query) } as any);
  await page('&days=365');
  expect((await page('') as any).days).toBe(365);
  await page('&days=90');
  expect((await page('') as any).days).toBe(90);
  expect(daily.mock.calls.map((c) => c[3])).toEqual([365, 365, 90, 90]);
});

it('restores geo on reload and preserves it when the monitor is temporarily unavailable', async () => {
  const event = (geo = '') => ({ params: { site }, locals, url: new URL('http://localhost/serp'+(geo ? '?geo='+geo : '')) }) as any;
  await GET(event('es'));
  expect(getSiteViewSettings(testDb, site).geo).toBe('es');
  expect((await (await GET(event())).json()).geo).toBe('es');
  expect(positions.mock.calls.at(-1)?.[1]).toBe('es');
  bindings.mockResolvedValue({ state: 'error', bindings: [] });
  await GET(event());
  expect(getSiteViewSettings(testDb, site).geo).toBe('es');
});

it('updates sorting without overwriting saved dates or geo', async () => {
  saveSiteViewSettings(testDb, site, { days: 365, geo: 'es' });
  const event = { params: { site }, locals, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ sort: 'clicks', dir: 'desc', tab: 'keywords' }) }) } as any;
  expect(await (await POST(event)).json()).toMatchObject({ days: 365, geo: 'es', sort: 'clicks', dir: 'desc', tab: 'keywords' });
});

it('refuses settings writes by non-admins', async () => {
  const event = { params: { site }, locals: { user: { role: 'manager' } }, request: new Request('http://localhost', { method: 'POST', body: '{}' }) } as any;
  await expect(POST(event)).rejects.toMatchObject({ status: 403 });
});

it('refreshes named markers for this site and window while retaining the event history', async () => {
  daily.mockResolvedValue({ series: [{ date: '2026-11-08' }, { date: '2026-11-10' }] });
  addSiteEvent(testDb, { siteHost: 'example.com', date: '2026-11-09', type: 'custom', note: 'Переезд в подпапку' });
  addSiteEvent(testDb, { siteHost: 'example.com', date: '2026-11-07', type: 'custom', note: 'Outside' });
  addSiteEvent(testDb, { siteHost: 'other.com', date: '2026-11-09', type: 'custom', note: 'Other' });
  const result = await load({ params: { site }, locals, url: new URL('http://localhost/?acc=account') } as any) as any;
  expect(result.siteEvents).toEqual([expect.objectContaining({ date: '2026-11-09', label: 'Переезд в подпапку' })]);
  expect(result.eventRows).toHaveLength(2);
});
