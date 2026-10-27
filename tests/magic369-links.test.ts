import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { Magic369Client, validateMagic369Link } from '../src/lib/server/magic369';
import { listPurchases, orderService, recordPurchases } from '../src/lib/server/magiclinks-purchases';
import { POST as quote } from '../src/routes/magiclinks/purchase/+server';
import { POST as submit } from '../src/routes/magiclinks/purchase/submit/+server';
import { load } from '../src/routes/magiclinks/[orderId]/+page.server';
import { GET as csv } from '../src/routes/magiclinks/[orderId]/csv/+server';
import { magicProviderInfos } from '../src/lib/server/magiclinks-providers';
let database: Db;
let client: Magic369Client;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => database }));
vi.mock('../src/lib/server/magic369', async (original) => ({ ...await original<typeof import('../src/lib/server/magic369')>(), magic369Client: () => client }));
vi.mock('../src/lib/server/magiclinks', async (original) => ({ ...await original<typeof import('../src/lib/server/magiclinks')>(), magicLinksClient: () => null }));
const item = { targetUrl: 'https://acceptor.test/page', query: 'apartments', count: 5 };
const event = (body: unknown) => ({ locals: { user: { role: 'admin' } }, request: new Request('http://localhost/magiclinks/purchase', { method: 'POST', body: JSON.stringify(body) }) }) as any;
const readEvent = () => ({ locals: { user: { role: 'admin' } }, params: { orderId: 'homepage-order' }, url: new URL('http://localhost/magiclinks/homepage-order') }) as any;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const balance = { balance: 100, price_per_placement: 0.45, link_price: 3 };
const order = { order_id: 'homepage-order', status: 'in_progress', price_per_placement: 3, total_price: 15,
  progress: { total: 6, published: 1, in_progress: 4, failed: 1, remaining: 4 },
  items: [{ url: item.targetUrl, anchor: item.query, count: 5, bonus_count: 1, published: 1, in_progress: 4, failed: 1, text: 'See $LINK' }] };
const links = { links: [{ id: 123, url: item.targetUrl, anchor: item.query, text: 'See $LINK', page_url: 'https://donor.test/', website: 'donor.test', published_at: '2026-10-27T12:00:00Z' }] };
beforeEach(() => { database = openDb(':memory:'); client = new Magic369Client('test-token', 'https://api.test/v1', 0); });
afterEach(() => { database.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('quotes homepage placements with live link price and per-row bonuses without a paid request or language', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(balance)); vi.stubGlobal('fetch', fetch);
  const result = await (await quote(event({ provider: 'magic369', service: 'links', items: [item, { ...item, targetUrl: 'https://other.test/', count: 3 }] }))).json();
  expect(result).toMatchObject({ provider: 'magic369', service: 'links', requested: 8,
    quote: { amountMinor: 2400, placementCount: 8, bonusCount: 1, totalPlacementCount: 9, canSubmit: true } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('https://api.test/v1/balance');
});
it('exposes homepage capability and the separate live price', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(balance)));
  const [, provider] = await magicProviderInfos(database);
  expect(provider).toMatchObject({ services: ['posts', 'links'], priceMinor: 45, linkPriceMinor: 300 });
});
it.each([undefined, 0, -1, '3'])('refuses to invent a homepage price when link_price is %s', async (link_price) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...balance, link_price })));
  await expect(quote(event({ provider: 'magic369', service: 'links', items: [item] }))).rejects.toMatchObject({ status: 502 });
});
it('sends only documented homepage fields to /link-orders and saves its service', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(balance)).mockResolvedValueOnce(reply({ order_id: 'homepage-order', status: 'queued', total_count: 5, total_price: 15, price_per_placement: 3, balance: 85 }, 201));
  vi.stubGlobal('fetch', fetch);
  const result = await (await submit(event({ provider: 'magic369', service: 'links', expectedMinor: 1500, items: [{ ...item, text: 'See $LINK', language: 'ignored', tier: 'ignored' }] }))).json();
  expect(result).toMatchObject({ orderId: 'homepage-order', service: 'links', order: { amountMinor: 1500 } });
  const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.test/v1/link-orders');
  expect(JSON.parse(init.body as string)).toEqual([{ url: item.targetUrl, anchor: item.query, count: 5, text: 'See $LINK' }]);
  expect(listPurchases(database)).toMatchObject([{ service: 'links', provider: 'magic369', language: '', quantity: 5 }]);
  expect(orderService(database, 'homepage-order')).toBe('links');
});
it('blocks payment on changed price or insufficient funds', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(balance)); vi.stubGlobal('fetch', fetch);
  await expect(submit(event({ provider: 'magic369', service: 'links', expectedMinor: 1499, items: [item] }))).rejects.toMatchObject({ status: 409 });
  fetch.mockResolvedValue(reply({ ...balance, balance: 1 }));
  await expect(submit(event({ provider: 'magic369', service: 'links', expectedMinor: 1500, items: [item] }))).rejects.toMatchObject({ status: 402 });
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/balance'))).toBe(true);
  expect(listPurchases(database)).toHaveLength(0);
});
it('never retries a paid homepage POST after an ambiguous failure', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(balance)).mockRejectedValueOnce(new TypeError('connection lost')); vi.stubGlobal('fetch', fetch);
  await expect(submit(event({ provider: 'magic369', service: 'links', expectedMinor: 1500, items: [item] }))).rejects.toMatchObject({ status: 504 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(listPurchases(database)).toHaveLength(0);
});
it.each([
  { text: 'missing placeholder' }, { text: '$LINK $LINK' }, { text: '$link' }, { text: '<b>$LINK</b>' }, { text: '$LINK\n' },
  { text: 'x'.repeat(1001) + '$LINK' }, { query: 'x'.repeat(201) }, { query: '<b>anchor</b>' }, { query: '$LINK' },
  { query: 'anchor\t' }, { targetUrl: 'javascript:alert(1)' }, { count: 0 }, { count: 1.5 }, { count: 251 }
])('rejects invalid homepage row before quote or payment: %j', async (overrides) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const body = { provider: 'magic369', service: 'links', expectedMinor: 1500, items: [{ ...item, ...overrides }] };
  await expect(quote(event(body))).rejects.toMatchObject({ status: 400 });
  await expect(submit(event(body))).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it('accepts bare links and a single placeholder', () => {
  expect(validateMagic369Link(item)).toEqual({ url: item.targetUrl, anchor: item.query, count: 5 });
  expect(validateMagic369Link({ ...item, text: '$LINK' }).text).toBe('$LINK');
});
it('reads homepage status and actual donor URLs for order details and monitoring', async () => {
  recordPurchases(database, [{ siteHost: 'acceptor.test', targetUrl: item.targetUrl, query: item.query, language: '', quantity: 5, taskId: '', orderId: 'homepage-order', provider: 'magic369', service: 'links' }]);
  const fetch = vi.fn(async (url) => reply(String(url).endsWith('/links') ? links : order)); vi.stubGlobal('fetch', fetch);
  const result = await load(readEvent()) as any;
  expect(result.content.order).toMatchObject({ service: 'links', progress: { total: 6 } });
  expect(result.content.articles[0]).toMatchObject({ publishedUrl: 'https://donor.test/', title: 'See $LINK' });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://api.test/v1/link-orders/homepage-order', 'https://api.test/v1/link-orders/homepage-order/links']);
  expect(database.prepare('SELECT source_url FROM backlink_placements').get()).toMatchObject({ source_url: 'https://donor.test/' });
});
it('discovers an unknown homepage order only after a 404 from article orders', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ error: { code: 'not_found' } }, 404)).mockResolvedValueOnce(reply(order)); vi.stubGlobal('fetch', fetch);
  expect((await client.order('homepage-order')).service).toBe('links');
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://api.test/v1/orders/homepage-order', 'https://api.test/v1/link-orders/homepage-order']);
});
it('exports homepage donors, text and pending/failed placements including bonuses', async () => {
  recordPurchases(database, [{ siteHost: 'acceptor.test', targetUrl: item.targetUrl, query: item.query, language: '', quantity: 5, taskId: '', orderId: 'homepage-order', provider: 'magic369', service: 'links' }]);
  vi.stubGlobal('fetch', vi.fn(async (url) => reply(String(url).endsWith('/links') ? links : order)));
  const response = await csv(readEvent());
  const text = await response.text();
  expect(text).toContain('https://donor.test/');
  expect(text).toContain('See $LINK');
  expect(text).toContain('failed');
  expect(text.trim().split('\n')).toHaveLength(7);
});

it('does not retry a paid homepage POST on an HTTP server error', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ error: { code: 'internal_error' } }, 500)); vi.stubGlobal('fetch', fetch);
  await expect(client.createOrder([{ url: item.targetUrl, anchor: item.query, count: 5 }], 'links')).rejects.toMatchObject({ status: 500 });
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not probe another order type on authentication failure', async () => {
  const fetch = vi.fn().mockResolvedValue(reply({ error: { code: 'unauthorized' } }, 401)); vi.stubGlobal('fetch', fetch);
  await expect(client.order('homepage-order')).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledOnce();
});
