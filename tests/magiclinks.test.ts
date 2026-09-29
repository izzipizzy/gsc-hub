import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { configSource } from '../src/lib/server/config';
import {
  MagicLinksClient,
  MagicLinksError,
  maskToken,
  getMagicLinksToken,
  setMagicLinksToken,
  clearMagicLinksToken,
  magicLinksClient,
  getMagicLinksBase,
  validateBrief,
  bonusFor
} from '../src/lib/server/magiclinks';
import { defaultLanguageForHost, LANGUAGE_CODES } from '../src/lib/utils/lang';
import {
  recordPurchases,
  purchaseSummary,
  orderRecorded,
  importOrderHistory,
  type PurchaseInput
} from '../src/lib/server/magiclinks-purchases';

const ENV_KEYS = ['MAGICLINKS_API_TOKEN', 'MAGICLINKS_API_BASE'];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

/** Ответ MagicLinks с JSON-телом. */
function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('magiclinks token config', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    clearEnv();
    dir = mkdtempSync(join(tmpdir(), 'gsc-flk-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    clearEnv();
  });

  it('нет ключа — нет клиента', () => {
    expect(getMagicLinksToken(db)).toBeUndefined();
    expect(magicLinksClient(db)).toBeNull();
  });

  it('ключ из базы поднимает клиента', () => {
    setMagicLinksToken(db, 'flk_secret_value_1234');
    expect(getMagicLinksToken(db)).toBe('flk_secret_value_1234');
    expect(magicLinksClient(db)).toBeInstanceOf(MagicLinksClient);
    expect(configSource(db, 'MAGICLINKS_API_TOKEN')).toBe('db');
  });

  it('окружение главнее базы', () => {
    setMagicLinksToken(db, 'from-db-token-value');
    process.env.MAGICLINKS_API_TOKEN = 'from-env-token-value';
    expect(getMagicLinksToken(db)).toBe('from-env-token-value');
  });

  it('clear убирает ключ базы, но не трогает окружение', () => {
    setMagicLinksToken(db, 'from-db-token-value');
    clearMagicLinksToken(db);
    expect(getMagicLinksToken(db)).toBeUndefined();

    process.env.MAGICLINKS_API_TOKEN = 'from-env-token-value';
    clearMagicLinksToken(db);
    expect(getMagicLinksToken(db)).toBe('from-env-token-value');
  });

  it('база API берётся из настройки, иначе дефолт', () => {
    expect(getMagicLinksBase(db)).toMatch(/^https:\/\//);
    process.env.MAGICLINKS_API_BASE = 'https://example.test/api/customer/v1';
    expect(getMagicLinksBase(db)).toBe('https://example.test/api/customer/v1');
  });

  it('пустой ключ не сохраняется', () => {
    expect(() => setMagicLinksToken(db, '   ')).toThrow();
  });
});

describe('maskToken', () => {
  it('показывает только края', () => {
    expect(maskToken('flk_nGbCMWEWanAH4_ABCD')).toBe('flk_…ABCD');
    expect(maskToken('short')).toBe('••••');
  });
});

describe('MagicLinksClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('склеивает страницы заказа по id и не теряет строки при сдвиге', async () => {
    const page0 = {
      order: {
        id: 'o1',
        status: 'processing',
        rowCount: 3,
        completedCount: 1,
        failedCount: 0,
        pagination: { page: 0, pageSize: 2, totalRows: 3, totalPages: 2 },
        rows: [
          { id: 'r1', status: 'completed', input: { targetUrl: 'u1', anchor: 'a1', language: 'en' }, result: { destination: 'https://donor/1' } },
          { id: 'r2', status: 'queued', input: { targetUrl: 'u2', anchor: 'a2', language: 'en' }, result: null }
        ]
      }
    };
    const page1 = {
      order: {
        ...page0.order,
        pagination: { page: 1, pageSize: 2, totalRows: 3, totalPages: 2 },
        // r2 приехал второй раз — страницы сдвинулись, пока менялись статусы
        rows: [
          { id: 'r2', status: 'completed', input: { targetUrl: 'u2', anchor: 'a2', language: 'en' }, result: { destination: 'https://donor/2' } },
          { id: 'r3', status: 'queued', input: { targetUrl: 'u3', anchor: 'a3', language: 'en' }, result: null }
        ]
      }
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      calls.push(url.searchParams.get('page') ?? '');
      return jsonRes(url.searchParams.get('page') === '0' ? page0 : page1);
    }));

    const { order, rows } = await new MagicLinksClient('t', 'https://api.test/v1', 0).order('o1');
    expect(calls).toEqual(['0', '1']);
    expect(order.id).toBe('o1');
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    // повтор перезаписывает более свежим статусом, а не дублирует строку
    expect(rows.find((r) => r.id === 'r2')?.status).toBe('completed');
  });

  it('ошибку отдаёт кодом и сообщением сервиса', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: false, code: 'PRICE_CHANGED', message: 'цена изменилась' }, 409)));
    const client = new MagicLinksClient('t', 'https://api.test/v1', 0);
    await expect(client.balance()).rejects.toMatchObject({
      name: 'MagicLinksError',
      status: 409,
      code: 'PRICE_CHANGED'
    });
  });

  it('не ходит за редиректом авторизованного запроса', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://evil.test/' } })));
    const client = new MagicLinksClient('t', 'https://api.test/v1', 0);
    await expect(client.balance()).rejects.toBeInstanceOf(MagicLinksError);
  });

  it('повторяет 429 по Retry-After и возвращает ответ', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ ok: false, message: 'too many' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonRes({ balanceMinor: 100, totalBalanceMinor: 100, reservedMinor: 0, scale: 100 }));
    vi.stubGlobal('fetch', fetchMock);
    const balance = await new MagicLinksClient('t', 'https://api.test/v1', 0).balance();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(balance.balanceMinor).toBe(100);
  });

  it('шлёт Bearer и не шлёт тело в GET', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await new MagicLinksClient('secret-token', 'https://api.test/v1', 0).health();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.test/v1/health');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('manual');
  });

  it('пагинация задач идёт по nextOffset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ tasks: [{ id: 't1' }], nextOffset: 100 }))
      .mockResolvedValueOnce(jsonRes({ tasks: [{ id: 't2' }], nextOffset: null }));
    vi.stubGlobal('fetch', fetchMock);
    const tasks = await new MagicLinksClient('t', 'https://api.test/v1', 0).listTasks();
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('validateBrief', () => {
  const ok = {
    targetUrl: 'https://example.es/casinos/',
    anchor: 'casino online',
    titleKeyword: 'casino online',
    language: 'es',
    count: 5
  };

  it('возвращает нормализованный бриф с count-числом', () => {
    expect(validateBrief({ ...ok, count: 5 })).toEqual({
      targetUrl: 'https://example.es/casinos/',
      anchor: 'casino online',
      titleKeyword: 'casino online',
      language: 'es',
      count: 5
    });
  });

  it('одна строка — один URL акцептора', () => {
    expect(() => validateBrief({ ...ok, targetUrl: 'https://a.es/ https://b.es/' })).toThrow(/пробел/);
  });

  it('требует абсолютный http(s) без логина', () => {
    expect(() => validateBrief({ ...ok, targetUrl: '/casinos/' })).toThrow();
    expect(() => validateBrief({ ...ok, targetUrl: 'ftp://example.es/' })).toThrow(/http/);
    expect(() => validateBrief({ ...ok, targetUrl: 'https://u:p@example.es/' })).toThrow(/логин/);
  });

  it('язык только из списка сервиса, гео не подходит', () => {
    expect(() => validateBrief({ ...ok, language: 'ESP' })).toThrow(/язык/);
    expect(() => validateBrief({ ...ok, language: '' })).toThrow(/язык/);
    expect(validateBrief({ ...ok, language: 'fr-ca' }).language).toBe('fr-ca');
  });

  it('количество — целое 1..250', () => {
    expect(() => validateBrief({ ...ok, count: 0 })).toThrow(/количество/);
    expect(() => validateBrief({ ...ok, count: 251 })).toThrow(/количество/);
    expect(() => validateBrief({ ...ok, count: 2.5 })).toThrow(/количество/);
  });

  it('бракует пустой анкор и HTML в полях', () => {
    expect(() => validateBrief({ ...ok, anchor: '  ' })).toThrow(/анкор/);
    expect(() => validateBrief({ ...ok, titleKeyword: '<a href="#">x</a>' })).toThrow(/HTML/);
  });

  it('номер строки попадает в сообщение', () => {
    expect(() => validateBrief({ ...ok, count: 0 }, 3)).toThrow(/строка 4/);
  });
});

describe('bonusFor', () => {
  it('25% с округлением вверх, как в доке сервиса', () => {
    expect(bonusFor(100)).toBe(25);
    expect(bonusFor(50)).toBe(13);
    expect(bonusFor(25)).toBe(7);
    expect(bonusFor(1)).toBe(1);
  });
});

describe('defaultLanguageForHost', () => {
  it('однозначные домены дают язык', () => {
    expect(defaultLanguageForHost('example.es')).toBe('es');
    expect(defaultLanguageForHost('example.fr')).toBe('fr');
    expect(defaultLanguageForHost('www.example.de')).toBe('de');
    expect(defaultLanguageForHost('loja.com.br')).toBe('pt');
  });

  it('.uk это английский, а код uk — украинский', () => {
    expect(defaultLanguageForHost('example.uk')).toBe('en');
    expect(defaultLanguageForHost('example.co.uk')).toBe('en');
    expect(LANGUAGE_CODES.has('uk')).toBe(true);
  });

  it('неоднозначные домены не угадываются', () => {
    expect(defaultLanguageForHost('example.com')).toBe('');
    expect(defaultLanguageForHost('example.net')).toBe('');
    expect(defaultLanguageForHost('localhost')).toBe('');
  });
});

describe('purchases history', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-mlp-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const p = (over: Partial<PurchaseInput> = {}): PurchaseInput => ({
    siteHost: 'example.es',
    targetUrl: 'https://example.es/casinos/',
    query: 'casino online',
    language: 'es',
    quantity: 5,
    taskId: 't1',
    orderId: 'o1',
    ...over
  });

  it('копит количество по паре и помнит заказы', () => {
    recordPurchases(db, [p()], 1000);
    recordPurchases(db, [p({ orderId: 'o2', quantity: 3 })], 2000);
    const sum = purchaseSummary(db);
    const key = 'https://example.es/casinos/\ncasino online';
    expect(sum[key].quantity).toBe(8);
    expect(sum[key].lastAt).toBe(2000);
    expect(sum[key].orders.map((o) => o.orderId).sort()).toEqual(['o1', 'o2']);
  });

  it('разные пары не смешиваются', () => {
    recordPurchases(db, [p(), p({ query: 'другой запрос', orderId: 'o2' })]);
    expect(Object.keys(purchaseSummary(db))).toHaveLength(2);
  });

  it('фильтр по сайту', () => {
    recordPurchases(db, [p(), p({ siteHost: 'other.fr', targetUrl: 'https://other.fr/', orderId: 'o3' })]);
    expect(Object.keys(purchaseSummary(db, 'other.fr'))).toEqual(['https://other.fr/\ncasino online']);
  });

  it('orderRecorded отличает записанный заказ от нового', () => {
    expect(orderRecorded(db, 'o1')).toBe(false);
    recordPurchases(db, [p()]);
    expect(orderRecorded(db, 'o1')).toBe(true);
  });
});

describe('importOrderHistory', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-mli-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const host = (u: string) => {
    try {
      return new URL(u).host.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  const client = (calls: string[] = []) => ({
    listOrders: async () => {
      calls.push('orders');
      return [
        { id: 'o1', taskId: 't1', createdAt: '2026-09-21T08:08:35.352Z' },
        { id: 'o2', taskId: 't2', createdAt: '2026-09-20T10:00:00.000Z' }
      ];
    },
    taskRows: async (taskId: string) => {
      calls.push(`rows:${taskId}`);
      return taskId === 't1'
        ? [
            { targetUrl: 'https://a.es/p/', anchor: 'кей один', language: 'es', count: 5 },
            { targetUrl: 'https://a.es/p2/', anchor: 'кей два', language: 'es', count: 3 }
          ]
        : [{ targetUrl: 'https://b.fr/', anchor: 'cle', language: 'fr', count: 2 }];
    }
  });

  it('пишет историю по брифам сервиса с датой заказа', async () => {
    const res = await importOrderHistory(db, client(), host);
    expect(res).toEqual({ orders: 2, rows: 3 });
    const sum = purchaseSummary(db);
    expect(sum['https://a.es/p/\nкей один'].quantity).toBe(5);
    expect(sum['https://a.es/p/\nкей один'].lastAt).toBe(Date.parse('2026-09-21T08:08:35.352Z'));
    expect(sum['https://b.fr/\ncle'].quantity).toBe(2);
  });

  it('повторный импорт не задваивает и не перечитывает заказы', async () => {
    await importOrderHistory(db, client(), host);
    const calls: string[] = [];
    const res = await importOrderHistory(db, client(calls), host);
    expect(res).toEqual({ orders: 0, rows: 0 });
    expect(calls).toEqual(['orders']); // строки задач второй раз не запрашиваем
    expect(purchaseSummary(db)['https://a.es/p/\nкей один'].quantity).toBe(5);
  });

  it('заказ без задачи пропускается, а не падает', async () => {
    const res = await importOrderHistory(
      db,
      { listOrders: async () => [{ id: 'o9' }], taskRows: async () => [] },
      host
    );
    expect(res).toEqual({ orders: 0, rows: 0 });
  });
});

describe('дубли истории', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-mld-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const row = (over: Partial<PurchaseInput> = {}): PurchaseInput => ({
    siteHost: 'a.es',
    targetUrl: 'https://a.es/p/',
    query: 'кей',
    language: 'es',
    quantity: 5,
    taskId: 't1',
    orderId: 'o1',
    ...over
  });

  it('одна связка одного заказа пишется один раз', () => {
    expect(recordPurchases(db, [row()])).toBe(1);
    // Гонка двух импортов: проверка «заказ записан» уже пройдена обоими.
    expect(recordPurchases(db, [row()])).toBe(0);
    expect(purchaseSummary(db)['https://a.es/p/\nкей'].quantity).toBe(5);
  });

  it('разные заказы на одну связку складываются', () => {
    recordPurchases(db, [row()]);
    recordPurchases(db, [row({ orderId: 'o2', quantity: 3 })]);
    expect(purchaseSummary(db)['https://a.es/p/\nкей'].quantity).toBe(8);
  });

  it('миграция схлопывает дубли, записанные до уникального индекса', () => {
    const path = join(dir, 'legacy.db');
    const legacy = openDb(path);
    legacy.exec('DROP INDEX IF EXISTS idx_magiclinks_purchases_unique');
    const ins = legacy.prepare(
      `INSERT INTO magiclinks_purchases
         (site_host, target_url, query, language, quantity, task_id, order_id, created_at)
       VALUES ('a.es', 'https://a.es/p/', 'кей', 'es', 5, 't1', 'o1', 1000)`
    );
    ins.run();
    ins.run();
    expect(
      (legacy.prepare('SELECT COUNT(*) c FROM magiclinks_purchases').get() as { c: number }).c
    ).toBe(2);
    legacy.close();

    const migrated = openDb(path); // повторное открытие = прогон миграции
    expect(purchaseSummary(migrated)['https://a.es/p/\nкей'].quantity).toBe(5);
    migrated.close();
  });
});
