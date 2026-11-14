// Нагрузочный замер /dashboard и /properties на имитации GSC.
// Запуск: PERF=1 npx vitest run tests/perf   (без PERF пропускается).
// PERF_SITES — число сайтов (по умолчанию 10 000), PERF_LATENCY_MS — задержка
// имитации на запрос (по умолчанию 20 мс: цикл событий свободен, как с живым GSC; время
// ожидания GSC считается из числа запросов при 8 потоках и квоте 1200/мин —
// соблюдение квоты проверяет tests/gsc-limiter.test.ts на виртуальном времени).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { openDb, type Db } from '../../src/lib/server/db';
import { upsertAccount } from '../../src/lib/server/accounts';
import { gscLimiter } from '../../src/lib/server/gsc-limiter';

let testDb: Db;
vi.mock('../../src/lib/server/db', async (original) => ({
  ...(await original<typeof import('../../src/lib/server/db')>()),
  db: () => testDb
}));
vi.mock('../../src/lib/server/bing', async (original) => ({
  ...(await original<typeof import('../../src/lib/server/bing')>()),
  getBing: async () => ({ traffic: new Map(), queries: [] }),
  getBingWithin: async () => ({ traffic: new Map(), queries: [] })
}));
vi.mock('../../src/lib/server/algo-updates', () => ({ getAlgoUpdates: async () => ({ updates: [] }), updatesForChart: () => [] }));

const SITES = Number(process.env.PERF_SITES ?? 10_000);
const LATENCY = Number(process.env.PERF_LATENCY_MS ?? 20);
const GSC_LATENCY_S = 0.3;
const QPM = 1200;
const THREADS = 8;

const counts = { sites: 0, saq: 0, throttled: 0 };
let throttleShare = 0;
function dateRows(start: string, end: string) {
  const rows = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400_000) {
    rows.push({ keys: [new Date(t).toISOString().slice(0, 10)], clicks: 3, impressions: 40, ctr: 0.075, position: 12 });
  }
  return rows;
}
function fakeFetch(url: string, init?: RequestInit) {
  if (url.endsWith('/webmasters/v3/sites')) {
    counts.sites++;
    const siteEntry = Array.from({ length: SITES }, (_, i) => ({ siteUrl: `sc-domain:site${i}.com`, permissionLevel: 'siteOwner' }));
    return Promise.resolve(new Response(JSON.stringify({ siteEntry })));
  }
  counts.saq++;
  if (throttleShare > 0 && Math.random() < throttleShare) {
    counts.throttled++;
    return Promise.resolve(new Response('Quota exceeded', { status: 429 }));
  }
  const body = JSON.parse(String(init?.body ?? '{}'));
  const dims: string[] = body.dimensions;
  let rows;
  if (dims.length === 1 && dims[0] === 'date') rows = dateRows(body.startDate, body.endDate);
  else rows = Array.from({ length: Math.min(body.rowLimit ?? 1000, dims.includes('query') ? 50 : 20) }, (_, i) => ({
    keys: dims.map((d) => (d === 'page' ? `https://x/${i}` : `${d}-${i}`)), clicks: 1, impressions: 10, ctr: 0.1, position: 8
  }));
  const res = new Response(JSON.stringify({ rows }));
  return LATENCY ? new Promise<Response>((r) => setTimeout(() => r(res), LATENCY)) : Promise.resolve(res);
}

const locals = { user: { role: 'admin' } } as any;
const cookies = { get: () => undefined } as any;

describe.skipIf(!process.env.PERF)(`portfolio ${SITES} sites`, () => {
  beforeAll(() => {
    testDb = openDb(':memory:');
    upsertAccount(testDb, { id: 'acc', email: 'a@x', access_token: 't', refresh_token: 'r', expires_at: 9e9, scope: 's' });
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterAll(() => { testDb.close(); vi.unstubAllGlobals(); });

  async function measure(name: string, run: () => Promise<unknown>) {
    const before = { ...counts };
    const t0 = performance.now();
    const out = await run();
    const ms = performance.now() - t0;
    const bytes = Buffer.byteLength(JSON.stringify(out, (_k, v) => (v instanceof Map ? [...v] : v)));
    const req = counts.saq - before.saq;
    console.log(`${name.padEnd(40)} hub=${ms.toFixed(0).padStart(5)}ms  ответ=${(bytes / 1e3).toFixed(0).padStart(6)} КБ  GSC-запросов при открытии=${req}`);
    return { out: out as any, ms, bytes, req };
  }
  const gscWait = (req: number) => Math.max((req / THREADS) * GSC_LATENCY_S, (req / QPM) * 60) / 60;

  it('measures', async () => {
    // Real quota pacing would make this run take minutes; the pacing itself is
    // proven on virtual time in gsc-limiter.test.ts.
    gscLimiter.configure({ perAccountPerMinute: 1e9, projectPerMinute: 1e9, baseDelayMs: 1, maxDelayMs: 5 });
    const { portfolio } = await import('../../src/lib/server/portfolio');
    const { topStore } = await import('../../src/lib/server/portfolio-top');
    const dash = await import('../../src/routes/dashboard/+page.server');
    const props = await import('../../src/routes/properties/+page.server');
    const today = await import('../../src/routes/dashboard/today/+server');
    const pulse = await import('../../src/routes/properties/pulse/+server');
    const top = await import('../../src/routes/properties/top/+server');
    const url = (p: string) => new URL(`http://localhost${p}`);
    const openDash = (p = '/dashboard') => dash.load({ url: url(p), locals, cookies } as any) as Promise<any>;
    const openProps = (p = '/properties') => props.load({ url: url(p), locals } as any) as Promise<any>;
    const json = async (r: Response | Promise<Response>) => (await r).json();

    // 1. Cold: the page answers with progress, not after the pass.
    const cold = await measure('холодный /dashboard', () => openDash());
    expect(cold.ms).toBeLessThan(3_000);
    expect(cold.out.status.state).toBe('cold');
    const passStart = counts.saq - cold.req;
    await portfolio.settled();
    const passRequests = counts.saq - passStart;
    console.log(`полный проход date-серий: GSC-запросов=${passRequests} (≈${gscWait(passRequests).toFixed(1)} мин при квоте)`);
    expect(passRequests).toBe(SITES);

    // 2. Warm: every view comes from the snapshot, no requests.
    const views = [
      await measure('тёплый /dashboard', () => openDash()),
      await measure('тёплый /dashboard?page=50&sort=site', () => openDash('/dashboard?page=50&sort=site&dir=asc')),
      await measure('тёплый /dashboard/today', () => json(today.GET({ locals } as any))),
      await measure('тёплый /properties', () => openProps()),
      await measure('тёплый /properties?days=28&sort=clicks', () => openProps('/properties?days=28&sort=clicks')),
      await measure('тёплый /properties/pulse 480d', () => json(pulse.GET({ url: url('/properties/pulse?days=480'), locals } as any)))
    ];
    for (const v of views) {
      expect(v.req).toBe(0);
      expect(v.ms).toBeLessThan(300);
      expect(v.bytes).toBeLessThan(1_000_000);
    }

    // 3. During the hourly refresh: old numbers, at once; five parallel opens start one pass.
    portfolio.invalidate();
    const before = counts.saq;
    const during = await measure('во время обновления x5 параллельно', () => Promise.all([openDash(), openProps(), openDash('/dashboard?page=2'), openProps('/properties?page=3'), openDash()]));
    for (const p of during.out as any[]) expect(p.status).toMatchObject({ state: 'ready', refreshing: true });
    expect(during.ms).toBeLessThan(1_500);
    await portfolio.settled();
    expect(counts.saq - before).toBe(SITES);

    // 4. Top block: its own lazy pass (2 per site), then served from memory.
    const topQ = () => json(top.GET({ url: url('/properties/top?kind=queries&days=1'), locals } as any));
    const topP = () => json(top.GET({ url: url('/properties/top?kind=pages&days=1'), locals } as any));
    const topBefore = counts.saq;
    await measure('холодный Top queries', topQ);
    await topStore(1).settled();
    console.log(`проход Top-блока: GSC-запросов=${counts.saq - topBefore}`);
    expect(counts.saq - topBefore).toBe(SITES * 2);
    const tq = await measure('тёплый Top queries', topQ);
    const tq2 = await measure('тёплый Top queries, другая сортировка', () => json(top.GET({ url: url('/properties/top?kind=queries&days=1&sort=clicks&dir=desc&countries=country-1'), locals } as any)));
    const tp = await measure('тёплый Top pages', topP);
    for (const v of [tq, tq2, tp]) {
      expect(v.req).toBe(0);
      expect(v.bytes).toBeLessThan(1_000_000);
    }
    expect(tq.out.rows.length).toBeLessThanOrEqual(200);

    // 5. 429s: 10% of requests throttled; retries back off and the pass still completes.
    throttleShare = 0.1;
    counts.throttled = 0;
    portfolio.invalidate();
    await openDash();
    await portfolio.settled();
    throttleShare = 0;
    const after = await openDash();
    const failed = after.entries.filter((e: any) => e.error).length;
    console.log(`429: отклонено ${counts.throttled}, карточек с ошибкой после повторов: ${failed}`);
    expect(failed).toBe(0);
  }, 600_000);
});
