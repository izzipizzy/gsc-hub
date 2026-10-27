import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { MagicLinksClient, validateLinkBrief } from '../src/lib/server/magiclinks';
import { fieldlinkCsv } from '../src/lib/server/fieldlink-csv';
import { magicProviderInfos } from '../src/lib/server/magiclinks-providers';
import { listPurchases } from '../src/lib/server/magiclinks-purchases';
import { POST as quote } from '../src/routes/magiclinks/purchase/+server';
import { POST as submit } from '../src/routes/magiclinks/purchase/submit/+server';
let database: Db;
let client: MagicLinksClient;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => database }));
vi.mock('../src/lib/server/magiclinks', async (original) => ({ ...await original<typeof import('../src/lib/server/magiclinks')>(), magicLinksClient: () => client }));
vi.mock('../src/lib/server/magic369', async (original) => ({ ...await original<typeof import('../src/lib/server/magic369')>(), magic369Client: () => null }));
const brief = { targetUrl: 'https://acceptor.test/page', anchor: 'Apartment rental', language: 'en', count: 5, tier: 'traffic_25_249' as const, contentHint: 'rental apartments' };
const item = { ...brief, query: brief.anchor };
const event = (body: unknown) => ({ locals: { user: { role: 'admin' } }, request: new Request('http://localhost/magiclinks/purchase', { method: 'POST', body: JSON.stringify(body) }) }) as any;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { database = openDb(':memory:'); client = new MagicLinksClient('test-token', 'https://api.test/v1', 0); });
afterEach(() => { database.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['traffic_0_1', 'traffic_2_24', 'traffic_25_249'] as const)('sends current tier %s without post-only fields', (tier) => {
  const value = validateLinkBrief({ ...brief, tier, titleKeyword: 'must disappear' } as any);
  expect(value).toMatchObject({ tier, contentHint: 'rental apartments', count: 5 });
  expect(value).not.toHaveProperty('titleKeyword');
});
it.each(['', 'traffic_0', 'traffic_1_49', 'traffic_250_9999', 'traffic_10000_29999', 'traffic_30000_plus'])('rejects missing, historical or coming-soon tier %s', (tier) => {
  expect(() => validateLinkBrief({ ...brief, tier } as any)).toThrow(/тариф/);
});
it.each([undefined, null, '', '   ', '\t\n'])('requires a nonblank link subject before contacting the provider', async (contentHint) => {
  expect(() => validateLinkBrief({ ...brief, contentHint } as any)).toThrow(/тему текста/);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(quote(event({ service: 'links', items: [{ ...item, contentHint }] }))).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['https://example.test', '<b>topic</b>', '{rental|apartments}', 'a'.repeat(301)])('rejects invalid content subject', (contentHint) => {
  expect(() => validateLinkBrief({ ...brief, contentHint })).toThrow(/тема/);
});
it('quote only saves links and reads price; never starts a paid order', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ task: { id: 'task' } })).mockResolvedValueOnce(reply({ quote: { amountMinor: 2500, bonusCount: 0, canSubmit: true } }));
  vi.stubGlobal('fetch', fetch);
  const result = await (await quote(event({ provider: 'fieldlink', service: 'links', items: [item], requestId: 'campaign-123' }))).json();
  expect(result).toMatchObject({ taskId: 'task', service: 'links', quote: { amountMinor: 2500, bonusCount: 0 } });
  expect(String(fetch.mock.calls[0][0])).toBe('https://api.test/v1/links');
  const saved = JSON.parse(fetch.mock.calls[0][1].body);
  expect(saved.items).toEqual([brief]);
  expect(saved).not.toHaveProperty('topic');
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['https://api.test/v1/links', 'https://api.test/v1/tasks/task/quote']);
});
it('uses auto for posts and separates idempotency by service and attempt', async () => {
  const fetch = vi.fn(async (url) => reply(String(url).endsWith('/quote') ? { quote: { amountMinor: 35 } } : { taskId: 'task' }));
  vi.stubGlobal('fetch', fetch);
  for (const [service, requestId] of [['posts', 'attempt-one'], ['posts', 'attempt-one'], ['links', 'attempt-one'], ['posts', 'attempt-two']]) {
    await quote(event({ service, requestId, items: [item] }));
  }
  const calls = fetch.mock.calls.filter(([, opts]: any) => opts.method === 'POST') as any[];
  expect(JSON.parse(calls[0][1].body).topic).toBe('auto');
  const keys = calls.map(([, opts]) => opts.headers['Idempotency-Key']);
  expect(keys[0]).toBe(keys[1]);
  expect(new Set(keys).size).toBe(3);
});
it('rejects missing provider token and unknown service before calling any provider', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(quote(event({ provider: 'magic369', service: 'links', items: [item] }))).rejects.toMatchObject({ status: 400 });
  await expect(quote(event({ service: 'unknown', items: [item] }))).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it('preserves provider admission error and tells the user how to recover', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ code: 'LINK_EDITOR_UNAVAILABLE', message: 'unavailable' }, 403)));
  await expect(quote(event({ service: 'links', items: [item] }))).rejects.toMatchObject({ status: 403, body: { message: expect.stringContaining('links:write') } });
});
it('submits empty body with exact quoted price, records link briefs and handles replay', async () => {
  const fetch = vi.fn(async (url) => reply(String(url).includes('/rows')
    ? { task: { rows: [{ ...brief, count: undefined, quantity: 5 }] }, pagination: { totalPages: 1 } }
    : { order: { id: 'order', type: 'links', rowCount: 5 }, replayed: true }));
  vi.stubGlobal('fetch', fetch);
  const body = { provider: 'fieldlink', taskId: 'task', expectedMinor: 2500 };
  await submit(event(body)); await submit(event(body));
  const paid = fetch.mock.calls.filter(([url]) => String(url).includes('/orders')) as any[];
  expect(paid).toHaveLength(2);
  expect(paid[0][1].body).toBeUndefined();
  expect(paid[0][1].headers['X-FieldLink-Expected-Credits']).toBe('2500');
  expect(listPurchases(database)).toHaveLength(1);
  expect(listPurchases(database)[0]).toMatchObject({ query: brief.anchor, quantity: 5, provider: 'fieldlink' });
});
it('returns price changes instead of removing the expected-price guard', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ code: 'PRICE_CHANGED', message: 'changed' }, 409)));
  await expect(submit(event({ taskId: 'task', expectedMinor: 2500 }))).rejects.toMatchObject({ status: 409 });
  expect(listPurchases(database)).toHaveLength(0);
});
it('loads personal post and link prices and declares service capabilities per provider', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ balanceMinor: 5000, prices: { post: 35, traffic_0_1: 100, traffic_2_24: 200, traffic_25_249: 500 } })));
  const [field, second] = await magicProviderInfos(database);
  expect(field).toMatchObject({ priceMinor: 35, services: ['posts', 'links'], linkTiers: [ { priceMinor: 100 }, { priceMinor: 200 }, { priceMinor: 500 }] });
  expect(second.services).toEqual(['posts', 'links']);
});
it('does not fabricate estimates when prices are unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ balanceMinor: 5000 })));
  const [field] = await magicProviderInfos(database);
  expect(field.priceMinor).toBeNull();
  expect(field.linkTiers?.every((t) => t.priceMinor === null)).toBe(true);
});
it('collects all order pages for external history', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ orders: [{ id: 'one' }], nextOffset: 100 })).mockResolvedValueOnce(reply({ orders: [{ id: 'one' }, { id: 'two' }], nextOffset: null }));
  vi.stubGlobal('fetch', fetch);
  expect((await client.listOrders()).map((o) => o.id)).toEqual(['one', 'two']);
  expect(String(fetch.mock.calls[1][0])).toContain('offset=100');
});
describe('link CSV', () => {
  const row = { id: 'r', status: 'completed', input: brief, result: { donor: 'https://donor.test/', text: '<a href="https://acceptor.test">Apartment rental</a>' }, error: null } as any;
  it('exports donor, exact text, tier and optional content subject', () => {
    const csv = fieldlinkCsv('links', [row]);
    expect(csv).toContain('Content subject'); expect(csv).toContain('https://donor.test/'); expect(csv).toContain('traffic_25_249'); expect(csv).toContain('rental apartments'); expect(csv).toContain('<a href=');
    expect(csv).not.toContain('Ключевые слова для статьи');
  });
  it('keeps historical link and post column counts', () => {
    const old = { ...row, input: { ...brief, contentHint: undefined } };
    expect(fieldlinkCsv('links', [old]).split('\n')[0].split(',')).toHaveLength(7);
    expect(fieldlinkCsv('posts', []).split('\n')[0].split(',')).toHaveLength(6);
  });
});
