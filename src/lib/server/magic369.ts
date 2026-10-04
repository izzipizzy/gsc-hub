import type { Db } from './db';
import { getConfigValue, configSource, setConfigValue, clearConfigValue } from './config';
import { languageLabel } from '$lib/utils/lang';

// Единственный модуль, знающий второй провайдер покупок — 369Team
// (https://magiclinks.online, «API размещения статей», swagger 1.0).
// В отличие от FieldLink заказ тут одношаговый: POST /orders сразу списывает
// деньги, отдельной операции «расчёт» в API нет — цена приходит с /balance.
// Списка заказов в API тоже нет, поэтому история покупок пишется только в
// момент покупки и догонять заказы из кабинета нечем.

const DEFAULT_BASE = 'https://magiclinks.online/api/v1';

// Партнёрская метка: сервис засчитывает по ней наши заказы, шлём в каждом запросе.
// Имя заголовка - как у вендора, с одной «r».
const REFERRAL_HEADER = 'X-Referal-ID';
const REFERRAL_ID = 'izzypizzy';

export interface Magic369Balance {
  /** Баланс в minor units (токен = 100). */
  balanceMinor: number;
  /** Цена одного размещения в minor units. */
  priceMinor: number;
  currency: string;
}

/** Строка заказа: ровно те поля, что принимает POST /orders, лишние — 400. */
export interface Magic369OrderRow {
  url: string;
  anchor: string;
  /** Человеческое название языка («English», «Русский»), не код. */
  language: string;
  count: number;
}

export interface Magic369Progress {
  total: number;
  published: number;
  inProgress: number;
  awaitingContent: number;
  failed: number;
  remaining: number;
}

export interface Magic369OrderStatus {
  id: string;
  status: string;
  createdAt: string | null;
  finalizedAt: string | null;
  priceMinor: number;
  totalPriceMinor: number;
  refundedMinor: number;
  progress: Magic369Progress;
  items: {
    url: string;
    anchor: string;
    language: string;
    count: number;
    published: number;
    inProgress: number;
    awaitingContent: number;
    failed: number;
  }[];
}

export interface Magic369Article {
  id: number;
  url: string;
  anchor: string;
  title: string;
  publishedUrl: string;
  publishedAt: string | null;
}

const STATUSES_MINOR = 100; // токены приходят числом с копейками, деньги считаем в minor

function toMinor(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * STATUSES_MINOR) : 0;
}

/** Код языка из подсказки хаба → человеческое название для API 369. */
export function languageNameFor(code: string): string {
  const label = languageLabel(code);
  if (!label) throw new Error(`язык «${code}» не из списка сервиса`);
  return label;
}

export class Magic369Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'Magic369Error';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Magic369Client {
  private readonly token: string;
  private readonly base: string;
  private lastAt = 0;

  constructor(token: string, base: string = DEFAULT_BASE, private readonly minIntervalMs = 250) {
    this.token = token;
    this.base = base.replace(/\/+$/, '');
  }

  private async throttle(): Promise<void> {
    const wait = this.lastAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; retries?: number } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      [REFERRAL_HEADER]: REFERRAL_ID
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const retries = opts.retries ?? 2;
    const backoff = [2000, 5000, 10000];
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const res = await fetch(this.base + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // Авторизованный запрос не ходит за редиректом: заголовок с токеном не
        // должен уехать на чужой origin.
        redirect: 'manual',
        signal: AbortSignal.timeout(20000)
      });
      if (res.status >= 300 && res.status < 400) {
        throw new Magic369Error(res.status, 'REDIRECT', '369Team ответил редиректом на другой адрес');
      }

      const ct = res.headers.get('content-type') ?? '';
      const text = await res.text();
      const payload: unknown = ct.includes('json') ? safeJson(text) : text;

      if (res.ok) return payload as T;

      const retryable = res.status === 429 || res.status === 500 || res.status === 503;
      if (retryable && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff[Math.min(attempt, 2)]);
        continue;
      }
      const obj = (payload && typeof payload === 'object' ? payload : {}) as {
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
      throw new Magic369Error(
        res.status,
        obj.error?.code ?? obj.code,
        obj.error?.message ?? obj.message ?? `HTTP ${res.status} от 369Team`
      );
    }
  }

  /** Баланс и текущая цена размещения — единственный источник цены в этом API. */
  async balance(): Promise<Magic369Balance> {
    const d = await this.request<{ balance: number; currency?: string; price_per_placement: number }>(
      'GET',
      '/balance'
    );
    return {
      balanceMinor: toMinor(d.balance),
      priceMinor: toMinor(d.price_per_placement),
      currency: d.currency ?? 'tokens'
    };
  }

  /**
   * Создаёт заказ и сразу списывает деньги. Идемпотентности в API нет, поэтому
   * вызов идёт только с кнопки оплаты и один раз.
   */
  async createOrder(rows: Magic369OrderRow[]): Promise<{
    orderId: string;
    status: string;
    totalCount: number;
    totalPriceMinor: number;
    priceMinor: number;
    balanceAfterMinor: number;
  }> {
    const d = await this.request<{
      order_id: string;
      status: string;
      total_count: number;
      total_price: number;
      price_per_placement: number;
      balance: number;
    }>('POST', '/orders', { body: rows, retries: 0 });
    return {
      orderId: d.order_id,
      status: d.status,
      totalCount: Number(d.total_count),
      totalPriceMinor: toMinor(d.total_price),
      priceMinor: toMinor(d.price_per_placement),
      balanceAfterMinor: toMinor(d.balance)
    };
  }

  /** Статус заказа: сводка прогресса и состояние по каждой строке заказа. */
  async order(orderId: string): Promise<Magic369OrderStatus> {
    const d = await this.request<{
      order_id: string;
      status: string;
      created_at?: string | null;
      finalized_at?: string | null;
      price_per_placement: number;
      total_price: number;
      refunded?: number;
      progress?: Record<string, number>;
      items?: Record<string, unknown>[];
    }>('GET', `/orders/${encodeURIComponent(orderId)}`);

    const p = d.progress ?? {};
    const num = (k: string) => Number(p[k] ?? 0);
    return {
      id: d.order_id,
      status: d.status,
      createdAt: d.created_at ?? null,
      finalizedAt: d.finalized_at ?? null,
      priceMinor: toMinor(d.price_per_placement),
      totalPriceMinor: toMinor(d.total_price),
      refundedMinor: toMinor(d.refunded),
      progress: {
        total: num('total'),
        published: num('published'),
        inProgress: num('in_progress'),
        awaitingContent: num('awaiting_content'),
        failed: num('failed'),
        remaining: num('remaining')
      },
      items: (d.items ?? []).map((it) => ({
        url: String(it.url ?? ''),
        anchor: String(it.anchor ?? ''),
        language: String(it.language ?? ''),
        count: Number(it.count ?? 0),
        published: Number(it.published ?? 0),
        inProgress: Number(it.in_progress ?? 0),
        awaitingContent: Number(it.awaiting_content ?? 0),
        failed: Number(it.failed ?? 0)
      }))
    };
  }

  /** Уже размещённые статьи; список пополняется по мере выполнения заказа. */
  async orderArticles(orderId: string): Promise<Magic369Article[]> {
    const d = await this.request<{
      articles?: {
        id: number;
        url: string;
        anchor: string;
        title?: string;
        published_url: string;
        published_at?: string;
      }[];
    }>('GET', `/orders/${encodeURIComponent(orderId)}/articles`);
    return (d.articles ?? []).map((a) => ({
      id: Number(a.id),
      url: a.url,
      anchor: a.anchor,
      title: a.title ?? '',
      publishedUrl: a.published_url,
      publishedAt: a.published_at ?? null
    }));
  }
}

// --- токен -------------------------------------------------------------

export function getMagic369Token(db: Db): string | undefined {
  return getConfigValue(db, 'MAGIC369_API_TOKEN');
}

export function magic369TokenSource(db: Db): 'env' | 'db' | 'none' {
  return configSource(db, 'MAGIC369_API_TOKEN');
}

export function setMagic369Token(db: Db, token: string): void {
  const clean = token.trim();
  if (!clean) throw new Error('token required');
  setConfigValue(db, 'MAGIC369_API_TOKEN', clean);
}

export function clearMagic369Token(db: Db): void {
  clearConfigValue(db, 'MAGIC369_API_TOKEN');
}

export function getMagic369Base(db: Db): string {
  return getConfigValue(db, 'MAGIC369_API_BASE') ?? DEFAULT_BASE;
}

/** null, пока ключ не введён: покупка идёт через другого провайдера. */
export function magic369Client(db: Db): Magic369Client | null {
  const token = getMagic369Token(db);
  return token ? new Magic369Client(token, getMagic369Base(db)) : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { DEFAULT_BASE as MAGIC369_DEFAULT_BASE };
