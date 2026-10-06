import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { addUrlExclusion } from '../src/lib/server/site-url-exclusions';

let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({
  ...await original<typeof import('../src/lib/server/db')>(), db: () => testDb
}));
vi.mock('../src/lib/server/accounts', () => ({ getAccount: () => ({ id: 'account' }) }));
const { fetchRows } = vi.hoisted(() => ({ fetchRows: vi.fn() }));
vi.mock('../src/lib/server/google', () => ({ fetchSiteQueryPages: fetchRows }));
import { POST as indexPost } from '../src/routes/properties/[site]/indexing/+server';
import { GET } from '../src/routes/properties/[site]/analytics/+server';
import { POST, DELETE } from '../src/routes/properties/[site]/url-exclusions/+server';

beforeEach(() => { testDb = openDb(':memory:'); });
afterEach(() => { testDb.close(); vi.clearAllMocks(); });
const site = 'https://hatamatata.com/';
const locals = { user: { role: 'admin' } };
const row = (path: string, n: number) => ({ keys: [`query-${n}`, `https://hatamatata.com${path}`], position: 7, impressions: 1000 - n, clicks: 1, ctr: .01 });
const read = async (mode: string, mask: string) => (await GET({ params: { site }, locals, url: new URL(`http://localhost/analytics?acc=account&days=365&urlMode=${mode}&urlMask=${encodeURIComponent(mask)}`) } as any)).json();

it('applies saved exclusions and contains/not-contains filters before the 300-row limit', async () => {
  fetchRows.mockResolvedValue([...Array.from({ length: 305 }, (_, n) => row(`/b/${n}`, n)), row('/sale/one', 306), row('/sale/two', 307)]);
  addUrlExclusion(testDb, 'sc-domain:hatamatata.com', '/b/', 'mask');
  const filtered = await read('contains', '/sale/');
  expect(filtered.striking.map((r: any) => r.page)).toEqual(['https://hatamatata.com/sale/one', 'https://hatamatata.com/sale/two']);
  expect((await read('not_contains', '/sale/')).striking).toEqual([]);
  expect((await read('not_contains', '')).striking).toHaveLength(2);
  expect(filtered.ctr.opportunities.length).toBeGreaterThan(2); // exclusions only affect striking
});

it('requires an admin and validates exclusion input', async () => {
  const event = (body: unknown, user = locals) => ({ params: { site }, locals: user, request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }) }) as any;
  await expect(POST(event({ pattern: '/b/', kind: 'mask' }, { user: { role: 'manager' } }))).rejects.toMatchObject({ status: 403 });
  await expect(POST(event({ pattern: '', kind: 'mask' }))).rejects.toMatchObject({ status: 400 });
  await expect(POST(event({ pattern: '/b/', kind: 'other' }))).rejects.toMatchObject({ status: 400 });
  const saved = await (await POST(event({ pattern: '/b/', kind: 'mask' }))).json();
  expect(saved.exclusions).toHaveLength(1);
  const result = await DELETE(event({ id: saved.exclusions[0].id }));
  expect((await result.json()).exclusions).toEqual([]);
});

it('rejects malformed indexing JSON as a client error and enforces admin access first', async () => {
  const event = (body: string, user = locals) => ({ params: { site }, locals: user,
    request: new Request('http://localhost/indexing', { method: 'POST', body }) }) as any;
  for (const body of ['{', 'null', '[]', 'true']) {
    await expect(indexPost(event(body))).rejects.toMatchObject({ status: 400 });
  }
  await expect(indexPost(event('{', { user: { role: 'manager' } }))).rejects.toMatchObject({ status: 403 });
});
