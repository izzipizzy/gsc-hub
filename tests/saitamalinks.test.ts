import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { configSource } from '../src/lib/server/config';
import {
  SaitamaClient,
  SaitamaError,
  validateSaitamaRow,
  validateSaitamaRows,
  saitamaIdempotencyKey,
  amountMinorFor,
  saitamaStatus,
  isSaitamaOrderId,
  looksLikeSaitamaToken,
  resetSaitamaPace,
  getSaitamaToken,
  setSaitamaToken,
  clearSaitamaToken,
  getSaitamaBase,
  SAITAMALINKS_DEFAULT_BASE
} from '../src/lib/server/saitamalinks';
import { listPurchases, orderProvider } from '../src/lib/server/magiclinks-purchases';
import { POST as quote } from '../src/routes/magiclinks/purchase/+server';
import { POST as submit } from '../src/routes/magiclinks/purchase/submit/+server';
import { load } from '../src/routes/magiclinks/[orderId]/+page.server';
import { GET as csv } from '../src/routes/magiclinks/[orderId]/csv/+server';
import { magicProviderInfos, anyMagicProviderConfigured, isMagicProviderId } from '../src/lib/server/magiclinks-providers';

let database: Db;
let client: SaitamaClient | null;
vi.mock('../src/lib/server/db', async (original) => ({ ...(await original<typeof import('../src/lib/server/db')>()), db: () => database }));
vi.mock('../src/lib/server/saitamalinks', async (original) => ({
  ...(await original<typeof import('../src/lib/server/saitamalinks')>()),
  saitamaClient: () => client
}));
vi.mock('../src/lib/server/magiclinks', async (original) => ({ ...(await original<typeof import('../src/lib/server/magiclinks')>()), magicLinksClient: () => null }));
vi.mock('../src/lib/server/magic369', async (original) => ({ ...(await original<typeof import('../src/lib/server/magic369')>()), magic369Client: () => null }));

const ORDER_ID = '3f6c2a9e-8b1d-4c7a-9e2f-5a1b0c9d8e71';
const item = { targetUrl: 'https://acceptor.test/page', query: 'blue widgets', language: 'en', count: 5 };
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = (code: string, status: number, headers: Record<string, string> = {}) => reply({ error: { code, message: code } }, status, headers);
const balance = { balance: 120.5, currency: 'USD', price_per_placement: 0.075, price_usd_per_placement: 0.075, price_per_placement_no_indexation: 0.065, tier: { discount_pct: 25 }, price_tiers: [] };
const created = { order_id: ORDER_ID, status: 'queued', total_count: 5, total_price: 0.375, price_per_placement: 0.075, balance: 120.125 };
const order = {
  order_id: ORDER_ID, service: 'links', status: 'processing', created_at: '2026-11-25T09:15:02Z', finalized_at: null,
  price_per_placement: 0.075, total_price: 0.375, refunded: 0, client_ref: 'gsc-hub acceptor.test', indexation: true,
  progress: { total: 5, published: 2, in_progress: 3, awaiting_content: 0, failed: 0, remaining: 3 },
  items: [{ url: item.targetUrl, anchor: item.query, language: 'en', count: 5, published: 2, in_progress: 3, awaiting_content: 0, failed: 0 }]
};
const articles = { articles: [
  { id: 'a1', url: item.targetUrl, anchor: item.query, title: 'How to choose widgets', published_url: 'https://news.example.com/a1', published_at: '2026-11-25T10:00:00Z', indexation: { status: 'submitted' } },
  { id: 'a2', url: item.targetUrl, anchor: item.query, title: 'Widgets 101', published_url: 'https://news.example.com/a2', published_at: '2026-11-25T10:01:00Z', indexation: { status: 'indexed' } }
] };
const event = (body: unknown) => ({ locals: { user: { role: 'admin' } }, request: new Request('http://localhost/magiclinks/purchase', { method: 'POST', body: JSON.stringify(body) }) }) as any;
const readEvent = (id = ORDER_ID) => ({ locals: { user: { role: 'admin' } }, params: { orderId: id }, url: new URL(`http://localhost/magiclinks/${id}`) }) as any;
const newClient = () => new SaitamaClient('sl_test_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', 'https://api.test/v1', 0, [0], 0);

beforeEach(() => {
  resetSaitamaPace();
  database = openDb(':memory:');
  client = newClient();
});
afterEach(() => {
  database.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.SAITAMALINKS_API_TOKEN;
});

describe('client', () => {
  it('reads balance: USD → cents, fractional price in micros, required headers', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(balance));
    vi.stubGlobal('fetch', fetch);
    expect(await client!.balance()).toEqual({
      balanceMinor: 12050, priceMicros: 75_000, priceNoIndexMicros: 65_000, priceMinor: 7.5, currency: 'USD', discountPct: 25
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/balance');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toMatch(/^Bearer sl_test_/);
    expect(h['User-Agent']).toBeTruthy();
    expect(init.redirect).toBe('manual');
  });

  it('maps order, statuses and articles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(order)).mockResolvedValueOnce(reply(articles)));
    const o = await client!.order(ORDER_ID);
    expect(o).toMatchObject({ id: ORDER_ID, status: 'processing', totalPriceMinor: 38, priceMinor: 7.5, indexation: true,
      progress: { total: 5, published: 2, inProgress: 3, remaining: 3 }, items: [{ url: item.targetUrl, language: 'en', inProgress: 3 }] });
    const a = await client!.orderArticles(ORDER_ID);
    expect(a[1]).toEqual({ id: 'a2', url: item.targetUrl, anchor: item.query, title: 'Widgets 101', publishedUrl: 'https://news.example.com/a2', publishedAt: '2026-11-25T10:01:00Z', indexation: 'indexed' });
    expect(saitamaStatus('cancelled')).toBe('cancelled');
    expect(saitamaStatus('weird')).toBe('queued');
  });

  it('lists only article-link orders across cursor pages', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({ orders: [{ order_id: 'o1', service: 'links', status: 'completed', created_at: 'x', finalized_at: 'y', total_count: 3, price_per_placement: 0.1, total_price: 0.3, client_ref: null },
        { order_id: 'o2', service: 'indexer', status: 'completed', created_at: 'x', finalized_at: 'y', total_count: 9, price_per_placement: 0.01, total_price: 0.09 }], next_cursor: 'c2' }))
      .mockResolvedValueOnce(reply({ orders: [{ order_id: 'o3', status: 'queued', created_at: 'x', finalized_at: null, total_count: 1, price_per_placement: 0.1, total_price: 0.1 }], next_cursor: null }));
    vi.stubGlobal('fetch', fetch);
    const list = await client!.listOrders();
    expect(list.map((o) => o.id)).toEqual(['o1', 'o3']);
    expect(fetch.mock.calls[1][0]).toBe('https://api.test/v1/orders?limit=100&cursor=c2');
  });

  it('retries createOrder with the same Idempotency-Key after 503 and a dropped connection', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(fail('internal_error', 503))
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockResolvedValueOnce(reply(created, 201, { 'idempotent-replay': 'true' }));
    vi.stubGlobal('fetch', fetch);
    const rows = [{ url: item.targetUrl, anchor: item.query, language: 'en', count: 5 }];
    const res = await client!.createOrder(rows, { idempotencyKey: 'k-1', indexation: false, clientRef: 'gsc-hub x' });
    expect(res).toMatchObject({ orderId: ORDER_ID, totalPriceMinor: 38, replayed: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, init] of fetch.mock.calls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1');
      expect(JSON.parse(init.body as string)).toEqual({ items: rows, indexation: false, client_ref: 'gsc-hub x' });
    }
  });

  it('refuses to create an order without an Idempotency-Key', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(client!.createOrder([], { idempotencyKey: '' })).rejects.toThrow();
  });

  it('honours 429 Retry-After but not the daily cap; 402 and 422 surface as errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail('rate_limited', 429, { 'retry-after': '2' })).mockResolvedValueOnce(reply(balance));
    vi.stubGlobal('fetch', fetch);
    await client!.balance();
    expect(fetch).toHaveBeenCalledTimes(2);

    fetch.mockReset().mockResolvedValue(fail('daily_cap_exceeded', 429, { 'retry-after': '40000' }));
    await expect(client!.balance()).rejects.toMatchObject({ status: 429, code: 'daily_cap_exceeded' });
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockReset().mockResolvedValue(fail('insufficient_balance', 402));
    await expect(client!.createOrder([], { idempotencyKey: 'k' })).rejects.toMatchObject({ status: 402, code: 'insufficient_balance' });
    fetch.mockReset().mockResolvedValue(fail('idempotency_conflict', 422));
    await expect(client!.createOrder([], { idempotencyKey: 'k' })).rejects.toBeInstanceOf(SaitamaError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throttles to the per-key limit', async () => {
    const slow = new SaitamaClient('sl_test_throttle_key_aaaaaaaaaaaaaaaaaaaaaaaa', 'https://api.test/v1', 40, [0], 0);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply(balance)));
    const t0 = Date.now();
    await Promise.all([slow.balance(), slow.balance(), slow.balance()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
  });
});

describe('validation and money', () => {
  it.each([
    { query: '' }, { query: 'x'.repeat(301) }, { query: '<b>a</b>' }, { query: 'a\nb' }, { targetUrl: 'ftp://x.test/' },
    { targetUrl: 'not a url' }, { targetUrl: 'https://u:p@x.test/' }, { language: '' }, { language: 'xx' },
    { count: 0 }, { count: 251 }, { count: 1.5 }
  ])('rejects bad row %j', (o) => {
    expect(() => validateSaitamaRow({ ...item, ...o } as any)).toThrow(/Строка 1/);
  });
  it('accepts http/https, maps hub fields to API fields', () => {
    expect(validateSaitamaRow({ ...item, targetUrl: 'http://x.test/a' } as any)).toEqual({ url: 'http://x.test/a', anchor: 'blue widgets', language: 'en', count: 5 });
  });
  it('enforces 100 rows and 500 links per order', () => {
    expect(() => validateSaitamaRows(Array.from({ length: 101 }, () => ({ ...item, count: 1 })))).toThrow(/100 строк/);
    expect(() => validateSaitamaRows([{ ...item, count: 250 }, { ...item, count: 250 }, { ...item, count: 1 }])).toThrow(/500 ссылок/);
    expect(validateSaitamaRows([{ ...item, count: 250 }, { ...item, count: 250 }])).toHaveLength(2);
  });
  it('rounds only the total to cents', () => {
    expect(amountMinorFor(5, 75_000)).toBe(38);
    expect(amountMinorFor(10, 75_000)).toBe(75);
  });
  it('derives a stable key from attempt + contents', () => {
    const rows = [{ url: 'https://a.test/', anchor: 'a', language: 'en', count: 1 }];
    expect(saitamaIdempotencyKey('r1', rows, true)).toBe(saitamaIdempotencyKey('r1', rows, true));
    expect(saitamaIdempotencyKey('r1', rows, true)).not.toBe(saitamaIdempotencyKey('r2', rows, true));
    expect(saitamaIdempotencyKey('r1', rows, true)).not.toBe(saitamaIdempotencyKey('r1', rows, false));
    expect(saitamaIdempotencyKey('r1', rows, true)).toMatch(/^[\x21-\x7e]{1,255}$/);
  });
  it('recognises keys and order ids', () => {
    expect(looksLikeSaitamaToken('sl_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(true);
    expect(looksLikeSaitamaToken('sk_123')).toBe(false);
    expect(isSaitamaOrderId(ORDER_ID)).toBe(true);
    expect(isSaitamaOrderId('homepage-order')).toBe(false);
  });
});

describe('token config', () => {
  it('stores the key in app_config, env wins', async () => {
    const real = await vi.importActual<typeof import('../src/lib/server/saitamalinks')>('../src/lib/server/saitamalinks');
    expect(getSaitamaToken(database)).toBeUndefined();
    expect(real.saitamaClient(database)).toBeNull();
    setSaitamaToken(database, ' sl_test_db_value_1234567890 ');
    expect(getSaitamaToken(database)).toBe('sl_test_db_value_1234567890');
    expect(real.saitamaClient(database)).toBeInstanceOf(real.SaitamaClient);
    expect(getSaitamaBase(database)).toBe(SAITAMALINKS_DEFAULT_BASE);
    process.env.SAITAMALINKS_API_TOKEN = 'sl_live_from_env_1234567890';
    expect(getSaitamaToken(database)).toBe('sl_live_from_env_1234567890');
    expect(configSource(database, 'SAITAMALINKS_API_TOKEN')).toBe('env');
    delete process.env.SAITAMALINKS_API_TOKEN;
    clearSaitamaToken(database);
    expect(getSaitamaToken(database)).toBeUndefined();
  });
});

describe('registry', () => {
  it('returns three providers; Saitama in dollars with both prices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply(balance)));
    const infos = await magicProviderInfos(database);
    expect(infos.map((p) => p.id)).toEqual(['fieldlink', 'magic369', 'saitamalinks']);
    expect(infos[2]).toMatchObject({ name: 'SaitamaLinks', unit: '$', services: ['posts'], configured: true, balanceMinor: 12050, priceMinor: 7.5, priceNoIndexMinor: 6.5, error: null });
    expect(isMagicProviderId('saitamalinks')).toBe(true);
    expect(anyMagicProviderConfigured(database)).toBe(true);
  });
  it('without key: configured=false; API error goes into info', async () => {
    client = null;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await magicProviderInfos(database))[2]).toMatchObject({ configured: false, balanceMinor: null, error: null });
    expect(anyMagicProviderConfigured(database)).toBe(false);
    client = newClient();
    fetch.mockResolvedValue(fail('unauthorized', 401));
    expect((await magicProviderInfos(database))[2]).toMatchObject({ configured: true, balanceMinor: null, error: 'unauthorized' });
  });
});

describe('purchase routes', () => {
  it('quotes by /balance price; indexation=false is $0.01 cheaper per link', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply(balance));
    vi.stubGlobal('fetch', fetch);
    const withIdx = await (await quote(event({ provider: 'saitamalinks', items: [{ ...item, count: 10 }] }))).json();
    expect(withIdx).toMatchObject({ provider: 'saitamalinks', indexation: true, requested: 10, quote: { amountMinor: 75, balanceMinor: 12050, canSubmit: true } });
    const noIdx = await (await quote(event({ provider: 'saitamalinks', indexation: false, items: [{ ...item, count: 10 }] }))).json();
    expect(noIdx.quote.amountMinor).toBe(65);
    expect(withIdx.quote.amountMinor - noIdx.quote.amountMinor).toBe(10);
    expect(fetch.mock.calls.every(([u]) => String(u).endsWith('/balance'))).toBe(true);
  });

  it('rejects bad rows before contacting the service', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(quote(event({ provider: 'saitamalinks', items: [{ ...item, language: '' }] }))).rejects.toMatchObject({ status: 400 });
    await expect(submit(event({ provider: 'saitamalinks', requestId: 'attempt-0001', expectedMinor: 38, items: [{ ...item, count: 0 }] }))).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates the order, records history once, and a repeat of the same attempt replays without a second charge', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/balance')) return reply(balance);
      return reply(created, 201, fetch.mock.calls.filter(([u]) => String(u).endsWith('/orders')).length > 1 ? { 'idempotent-replay': 'true' } : {});
    });
    vi.stubGlobal('fetch', fetch);
    const body = { provider: 'saitamalinks', requestId: 'attempt-0001', expectedMinor: 38, items: [item] };
    const first = await (await submit(event(body))).json();
    const second = await (await submit(event(body))).json();
    expect(first).toMatchObject({ provider: 'saitamalinks', orderId: ORDER_ID, replayed: false, order: { amountMinor: 38 } });
    expect(second).toMatchObject({ orderId: ORDER_ID, replayed: true });
    const posts = fetch.mock.calls.filter(([u]) => String(u).endsWith('/orders')) as [string, RequestInit][];
    expect(posts).toHaveLength(2);
    const keys = posts.map(([, init]) => (init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(JSON.parse(posts[0][1].body as string)).toMatchObject({ indexation: true, items: [{ url: item.targetUrl, anchor: item.query, language: 'en', count: 5 }] });
    expect(listPurchases(database)).toHaveLength(1);
    expect(listPurchases(database)[0]).toMatchObject({ provider: 'saitamalinks', siteHost: 'acceptor.test', quantity: 5, orderId: ORDER_ID });
    expect(orderProvider(database, ORDER_ID)).toBe('saitamalinks');
  });

  it('a changed price gives 409 and creates nothing', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply({ ...balance, price_per_placement: 0.08 }));
    vi.stubGlobal('fetch', fetch);
    await expect(submit(event({ provider: 'saitamalinks', requestId: 'attempt-0001', expectedMinor: 38, items: [item] }))).rejects.toMatchObject({ status: 409 });
    expect(fetch.mock.calls.every(([u]) => String(u).endsWith('/balance'))).toBe(true);
    expect(listPurchases(database)).toHaveLength(0);
  });

  it('maps 402 from the service and requires a purchase attempt id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/balance') ? reply(balance) : fail('insufficient_balance', 402))));
    await expect(submit(event({ provider: 'saitamalinks', requestId: 'attempt-0001', expectedMinor: 38, items: [item] }))).rejects.toMatchObject({ status: 402 });
    await expect(submit(event({ provider: 'saitamalinks', expectedMinor: 38, items: [item] }))).rejects.toMatchObject({ status: 400 });
    expect(listPurchases(database)).toHaveLength(0);
  });
});

describe('order page and CSV', () => {
  const routes = (url: string) => {
    if (url.endsWith('/articles')) return reply(articles);
    if (url.includes(`/orders/${ORDER_ID}`)) return reply(order);
    return reply({ error: { code: 'not_found', message: 'not found' } }, 404);
  };

  it('loads a recorded Saitama order with articles and indexation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => routes(u)));
    database.prepare(`INSERT INTO magiclinks_purchases (site_host,target_url,query,language,quantity,task_id,order_id,provider,service,created_at)
      VALUES ('acceptor.test',?,?,'en',5,'',?, 'saitamalinks','posts',1)`).run(item.targetUrl, item.query, ORDER_ID);
    const data = (await load(readEvent())) as any;
    expect(data.content.kind).toBe('saitamalinks');
    expect(data.content.order.progress.published).toBe(2);
    expect(data.content.articles.map((a: any) => a.indexation)).toEqual(['submitted', 'indexed']);
  });

  it('finds an unrecorded UUID order at Saitama after the other providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => routes(u)));
    const data = (await load(readEvent())) as any;
    expect(data.content.kind).toBe('saitamalinks');
  });

  it('exports six columns: published, then the rest in progress', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => routes(u)));
    database.prepare(`INSERT INTO magiclinks_purchases (site_host,target_url,query,language,quantity,task_id,order_id,provider,service,created_at)
      VALUES ('acceptor.test',?,?,'en',5,'',?, 'saitamalinks','posts',1)`).run(item.targetUrl, item.query, ORDER_ID);
    const res = await csv(readEvent());
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0].split(',')).toHaveLength(6);
    expect(lines).toHaveLength(1 + 5);
    expect(lines.filter((l) => l.includes(',completed,'))).toHaveLength(2);
    expect(lines.filter((l) => l.includes(',in_progress,'))).toHaveLength(3);
    expect(text).toContain('https://news.example.com/a2');
  });
});
