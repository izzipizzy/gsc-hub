import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { configSource } from '../src/lib/server/config';
import {
  Magic369Client,
  Magic369Error,
  getMagic369Token,
  setMagic369Token,
  clearMagic369Token,
  magic369Client,
  getMagic369Base,
  languageNameFor
} from '../src/lib/server/magic369';
import {
  recordPurchases,
  purchaseSummary,
  orderProvider,
  type PurchaseInput
} from '../src/lib/server/magiclinks-purchases';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369, isMagicProviderId } from '../src/lib/server/magiclinks-providers';

const ENV_KEYS = ['MAGIC369_API_TOKEN', 'MAGIC369_API_BASE'];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('magic369 token config', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    clearEnv();
    dir = mkdtempSync(join(tmpdir(), 'gsc-m369-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    clearEnv();
  });

  it('нет ключа — нет клиента', () => {
    expect(getMagic369Token(db)).toBeUndefined();
    expect(magic369Client(db)).toBeNull();
  });

  it('ключ из базы поднимает клиента', () => {
    setMagic369Token(db, 'sk_secret_value_1234');
    expect(getMagic369Token(db)).toBe('sk_secret_value_1234');
    expect(magic369Client(db)).toBeInstanceOf(Magic369Client);
    expect(configSource(db, 'MAGIC369_API_TOKEN')).toBe('db');
  });

  it('окружение главнее базы', () => {
    setMagic369Token(db, 'from-db-token-value');
    process.env.MAGIC369_API_TOKEN = 'from-env-token-value';
    expect(getMagic369Token(db)).toBe('from-env-token-value');
  });

  it('clear убирает ключ базы, но не трогает окружение', () => {
    setMagic369Token(db, 'from-db-token-value');
    clearMagic369Token(db);
    expect(getMagic369Token(db)).toBeUndefined();

    process.env.MAGIC369_API_TOKEN = 'from-env-token-value';
    clearMagic369Token(db);
    expect(getMagic369Token(db)).toBe('from-env-token-value');
  });

  it('база API берётся из настройки, иначе дефолт 369', () => {
    expect(getMagic369Base(db)).toBe('https://magiclinks.online/api/v1');
    process.env.MAGIC369_API_BASE = 'https://example.test/api/v1';
    expect(getMagic369Base(db)).toBe('https://example.test/api/v1');
  });

  it('пустой ключ не сохраняется', () => {
    expect(() => setMagic369Token(db, '   ')).toThrow();
  });
});

describe('Magic369Client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('баланс и цена приходят в minor units', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ balance: 1000, currency: 'tokens', price_per_placement: 0.5 })));
    const balance = await new Magic369Client('t', 'https://api.test/v1', 0).balance();
    expect(balance).toEqual({ balanceMinor: 100000, priceMinor: 50, currency: 'tokens' });
  });

  it('создание заказа шлёт массив строк и не шлёт идемпотентность', async () => {
    const fetchMock = vi.fn(async () =>
      jsonRes({ order_id: 'o1', status: 'awaiting_content', total_count: 15, total_price: 7.5, price_per_placement: 0.5, balance: 992.5 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const created = await new Magic369Client('secret', 'https://api.test/v1', 0).createOrder([
      { url: 'https://example.es/casinos/', anchor: 'casino online', language: 'English', count: 15 }
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.test/v1/orders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual([
      { url: 'https://example.es/casinos/', anchor: 'casino online', language: 'English', count: 15 }
    ]);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect((init.headers as Record<string, string>)['X-Referal-ID']).toBe('izzypizzy');
    expect(created).toEqual({
      orderId: 'o1',
      status: 'awaiting_content',
      totalCount: 15,
      totalPriceMinor: 750,
      priceMinor: 50,
      balanceAfterMinor: 99250
    });
  });

  it('статус заказа нормализуется в прогресс и строки', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({
        order_id: 'o1',
        status: 'in_progress',
        created_at: '2026-09-23T10:00:00Z',
        finalized_at: null,
        price_per_placement: 0.5,
        total_price: 7.5,
        refunded: 0.25,
        progress: { total: 15, published: 7, in_progress: 3, awaiting_content: 2, failed: 1, remaining: 7 },
        items: [
          { url: 'https://a.es/p/', anchor: 'кей', language: 'Русский', count: 10, published: 6, in_progress: 3, awaiting_content: 0, failed: 1 }
        ]
      })
    ));
    const order = await new Magic369Client('t', 'https://api.test/v1', 0).order('o1');
    expect(order.status).toBe('in_progress');
    expect(order.totalPriceMinor).toBe(750);
    expect(order.refundedMinor).toBe(25);
    expect(order.progress).toEqual({ total: 15, published: 7, inProgress: 3, awaitingContent: 2, failed: 1, remaining: 7 });
    expect(order.items[0]).toEqual({
      url: 'https://a.es/p/', anchor: 'кей', language: 'Русский',
      count: 10, published: 6, inProgress: 3, awaitingContent: 0, failed: 1
    });
  });

  it('статьи заказа читаются списком', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({
        order_id: 'o1',
        total: 1,
        articles: [
          { id: 12345, url: 'https://example.es/page', anchor: 'лучшие', title: 'Как выбрать', published_url: 'https://donor.tld/post/', published_at: '2026-09-23T10:14:02Z' }
        ]
      })
    ));
    const articles = await new Magic369Client('t', 'https://api.test/v1', 0).orderArticles('o1');
    expect(articles).toEqual([
      { id: 12345, url: 'https://example.es/page', anchor: 'лучшие', title: 'Как выбрать', publishedUrl: 'https://donor.tld/post/', publishedAt: '2026-09-23T10:14:02Z' }
    ]);
  });

  it('ошибку отдаёт кодом и сообщением из error-обёртки', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ error: { code: 'insufficient_balance', message: 'insufficient balance: need 6.75 tokens, balance 4.5' } }, 402)
    ));
    const client = new Magic369Client('t', 'https://api.test/v1', 0);
    await expect(client.balance()).rejects.toMatchObject({
      name: 'Magic369Error',
      status: 402,
      code: 'insufficient_balance'
    });
  });

  it('не ходит за редиректом авторизованного запроса', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://evil.test/' } })));
    const client = new Magic369Client('t', 'https://api.test/v1', 0);
    await expect(client.balance()).rejects.toBeInstanceOf(Magic369Error);
  });

  it('создание заказа не повторяется при 5xx: деньги списались бы дважды', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ error: { code: 'internal_error', message: 'boom' } }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const client = new Magic369Client('t', 'https://api.test/v1', 0);
    await expect(client.createOrder([])).rejects.toBeInstanceOf(Magic369Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('languageNameFor', () => {
  it('код подсказки превращается в человеческое название', () => {
    expect(languageNameFor('en')).toBe('English');
    expect(languageNameFor('ru')).toBe('Русский');
    expect(languageNameFor('fr-ca')).toBe('Français (CA)');
  });

  it('неизвестный код бракуется до отправки в API', () => {
    expect(() => languageNameFor('ESP')).toThrow(/язык/);
    expect(() => languageNameFor('')).toThrow(/язык/);
  });
});

describe('providers registry', () => {
  it('идентификаторы провайдеров — закрытый список', () => {
    expect(isMagicProviderId('fieldlink')).toBe(true);
    expect(isMagicProviderId('magic369')).toBe(true);
    expect(isMagicProviderId('other')).toBe(false);
    expect(PROVIDER_FIELDLINK).toBe('fieldlink');
    expect(PROVIDER_MAGIC369).toBe('magic369');
  });
});

describe('purchases history with provider', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-mlprov-'));
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
    taskId: '',
    orderId: 'o1',
    ...over
  });

  it('без провайдера пишется fieldlink, с провайдером — он сам', () => {
    recordPurchases(db, [p()]);
    recordPurchases(db, [p({ orderId: 'o2', provider: 'magic369' })]);
    expect(orderProvider(db, 'o1')).toBe('fieldlink');
    expect(orderProvider(db, 'o2')).toBe('magic369');
  });

  it('неизвестный заказ — null, а не догадка', () => {
    expect(orderProvider(db, 'nope')).toBeNull();
  });

  it('одна покупка 369 суммируется с fieldlink по паре', () => {
    recordPurchases(db, [p()]);
    recordPurchases(db, [p({ orderId: 'o2', provider: 'magic369', quantity: 3 })]);
    const sum = purchaseSummary(db);
    expect(sum['https://example.es/casinos/\ncasino online'].quantity).toBe(8);
    expect(sum['https://example.es/casinos/\ncasino online'].orders.map((o) => o.orderId).sort()).toEqual(['o1', 'o2']);
  });
});

describe('provider column migration', () => {
  it('база до появления колонки получает её с дефолтом fieldlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gsc-mlmig-'));
    try {
      const path = join(dir, 'legacy.db');
      const legacy = openDb(path);
      legacy.exec('ALTER TABLE magiclinks_purchases DROP COLUMN provider');
      legacy
        .prepare(
          `INSERT INTO magiclinks_purchases
             (site_host, target_url, query, language, quantity, task_id, order_id, created_at)
           VALUES ('a.es', 'https://a.es/p/', 'кей', 'es', 5, 't1', 'o1', 1000)`
        )
        .run();
      legacy.close();

      const migrated = openDb(path); // повторное открытие = прогон миграции
      expect(orderProvider(migrated, 'o1')).toBe('fieldlink');
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
