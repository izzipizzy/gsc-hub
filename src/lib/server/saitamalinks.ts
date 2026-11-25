import { createHash } from 'node:crypto';
import type { Db } from './db';
import { getConfigValue, configSource, setConfigValue, clearConfigValue } from './config';
import { LANGUAGE_CODES } from '$lib/utils/lang';

// Единственный модуль, знающий третий провайдер покупок — SaitamaLinks
// (https://api.saitamalinks.com/api/v1, дока вендора — docs/saitamalinks-api-v1.md).
// Заказ одношаговый, как у 369Team: POST /orders сразу списывает доллары, цена
// приходит с /balance. В отличие от 369Team у API есть Idempotency-Key и
// список заказов (GET /orders с курсором), поэтому создание заказа можно
// безопасно повторять, а заказы мимо хаба видны в общем списке.
// Деньги приходят числом в USD (до 6 знаков); в хабе суммы — центы, но цена
// за ссылку дробная ($0.075), поэтому она живёт в микродолларах, а в центы
// переводится только итог.

const DEFAULT_BASE = 'https://api.saitamalinks.com/api/v1';
const USER_AGENT = 'gsc-hub (+saitamalinks client)';

export const SAITAMA_MAX_ROWS = 100;
export const SAITAMA_MAX_LINKS = 500;
export const SAITAMA_STATUSES = ['queued', 'processing', 'completed', 'cancelled'] as const;
export type SaitamaStatus = (typeof SAITAMA_STATUSES)[number];

/** USD → микродоллары: цена ссылки дробная в центах, считаем без потерь. */
export function usdToMicros(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : 0;
}
/** USD → центы с округлением: так хаб хранит и показывает суммы. */
export function usdToMinor(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
/** Сумма заказа в центах: штуки × цена, округление только в конце. */
export function amountMinorFor(count: number, priceMicros: number): number {
  return Math.round((count * priceMicros) / 10_000);
}

export interface SaitamaBalance {
  balanceMinor: number;
  /** Цена ссылки с индексацией, микродоллары. */
  priceMicros: number;
  /** Цена ссылки без индексации; null, если сервис её не отдал. */
  priceNoIndexMicros: number | null;
  /** Та же цена в центах (может быть дробной) — для подписи в интерфейсе. */
  priceMinor: number;
  currency: 'USD';
  discountPct: number;
}

/** Строка заказа — ровно поля POST /orders. */
export interface SaitamaOrderRow {
  url: string;
  anchor: string;
  /** Код языка (en), API принимает и названия, хаб шлёт код. */
  language: string;
  count: number;
}

export interface SaitamaProgress {
  total: number;
  published: number;
  inProgress: number;
  awaitingContent: number;
  failed: number;
  remaining: number;
}

export interface SaitamaOrder {
  id: string;
  service: string;
  status: SaitamaStatus;
  createdAt: string | null;
  finalizedAt: string | null;
  priceMinor: number;
  totalPriceMinor: number;
  refundedMinor: number;
  clientRef: string | null;
  indexation: boolean;
  progress: SaitamaProgress;
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

export interface SaitamaOrderListItem {
  id: string;
  service: string;
  status: SaitamaStatus;
  createdAt: string | null;
  finalizedAt: string | null;
  totalCount: number;
  totalPriceMinor: number;
  clientRef: string | null;
}

export interface SaitamaArticle {
  id: string;
  url: string;
  anchor: string;
  title: string;
  publishedUrl: string;
  publishedAt: string | null;
  /** pending / submitted / indexed / not_indexed / not_ordered */
  indexation: string;
}

export interface SaitamaCreated {
  orderId: string;
  status: SaitamaStatus;
  totalCount: number;
  totalPriceMinor: number;
  priceMinor: number;
  balanceAfterMinor: number;
  replayed: boolean;
}

/** Неизвестный статус не роняет страницу: считаем его очередью. */
export function saitamaStatus(v: unknown): SaitamaStatus {
  return (SAITAMA_STATUSES as readonly string[]).includes(String(v)) ? (v as SaitamaStatus) : 'queued';
}

/**
 * Проверка строки до отправки: сервис отклоняет весь заказ из-за одной плохой
 * строки, поэтому ловим это у себя и говорим номер строки.
 */
export function validateSaitamaRow(raw: Record<string, unknown>, index = 0): SaitamaOrderRow {
  const fail = (message: string): never => {
    throw new Error(`Строка ${index + 1}: ${message}`);
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('нужен объект');
  const url = String(raw.targetUrl ?? raw.url ?? '').trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    fail('нужен URL http/https');
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || /\s/.test(url) || url.length > 2048) {
    fail('нужен URL http/https');
  }
  if (parsed!.username || parsed!.password) fail('URL с логином или паролем сервис не примет');
  const rawAnchor = String(raw.query ?? raw.anchor ?? '');
  const anchor = rawAnchor.trim();
  const len = [...anchor].length;
  if (!anchor || len > 300 || /<[^>]*>/.test(anchor) || /[\r\n]/.test(rawAnchor)) {
    fail('анкор: 1–300 символов, без HTML и переносов строк');
  }
  const language = String(raw.language ?? '').trim().toLowerCase();
  if (!LANGUAGE_CODES.has(language)) fail(language ? `язык «${language}» не из списка` : 'нужен язык');
  const count = Number(raw.count);
  if (!Number.isInteger(count) || count < 1 || count > 250) fail('количество: от 1 до 250');
  return { url, anchor, language, count };
}

/** Весь заказ: лимиты сервиса на один POST /orders. */
export function validateSaitamaRows(raw: unknown): SaitamaOrderRow[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Пустое выделение');
  if (raw.length > SAITAMA_MAX_ROWS) {
    throw new Error(`SaitamaLinks принимает до ${SAITAMA_MAX_ROWS} строк за заказ`);
  }
  const rows = raw.map((r, i) => validateSaitamaRow(r as Record<string, unknown>, i));
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total > SAITAMA_MAX_LINKS) {
    throw new Error(`SaitamaLinks принимает до ${SAITAMA_MAX_LINKS} ссылок за заказ, выбрано ${total}`);
  }
  return rows;
}

/**
 * Детерминированный Idempotency-Key: одна попытка покупки (requestId из окна)
 * с тем же составом даёт тот же ключ, поэтому двойной клик и повтор после
 * обрыва возвращают уже созданный заказ, а не второй.
 */
export function saitamaIdempotencyKey(attempt: string, rows: SaitamaOrderRow[], indexation: boolean): string {
  const h = createHash('sha256')
    .update(JSON.stringify({ attempt, indexation, rows }))
    .digest('hex');
  return `gsc-hub-${h.slice(0, 48)}`;
}

export class SaitamaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'SaitamaError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Лимит — 60 запросов в минуту на ключ, а клиент создаётся на каждый запрос
// хаба, поэтому троттл общий на процесс и привязан к ключу.
const pace = new Map<string, { lastAt: number; blockedUntil: number }>();
/** Для тестов: забыть, когда ключ ходил в последний раз. */
export function resetSaitamaPace(): void {
  pace.clear();
}

/** Дольше этого Retry-After не ждём: суточный лимит ждать бессмысленно. */
const MAX_RETRY_WAIT_MS = 30_000;

export class SaitamaClient {
  private readonly token: string;
  private readonly base: string;
  private readonly paceKey: string;

  constructor(
    token: string,
    base: string = DEFAULT_BASE,
    private readonly minIntervalMs = 1100,
    /** Паузы между повторами, когда сервис не сказал Retry-After; тесты ставят 0. */
    private readonly backoff: readonly number[] = [2000, 5000, 10000],
    /** Множитель Retry-After (секунды → мс); тесты ставят 0. */
    private readonly retryAfterMs = 1000
  ) {
    this.token = token;
    this.base = base.replace(/\/+$/, '');
    this.paceKey = createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  /** Тестовый ключ: заказы симулируются, реальный баланс не трогается. */
  get testMode(): boolean {
    return this.token.startsWith('sl_test_');
  }

  private async throttle(): Promise<void> {
    const st = pace.get(this.paceKey) ?? { lastAt: 0, blockedUntil: 0 };
    pace.set(this.paceKey, st);
    const at = Math.max(st.lastAt + this.minIntervalMs, st.blockedUntil);
    // Слот резервируется до сна: параллельные вызовы встают в очередь.
    st.lastAt = Math.max(Date.now(), at);
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
  }

  private noteRateHeaders(res: Response): void {
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(reset)) {
      const st = pace.get(this.paceKey);
      if (st) st.blockedUntil = Math.min(reset * 1000, Date.now() + 60_000);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; retries?: number; headers?: Record<string, string> } = {}
  ): Promise<{ data: T; res: Response }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      // Без User-Agent сервис отвечает 403 ещё до проверки ключа.
      'User-Agent': USER_AGENT,
      ...opts.headers
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const retries = opts.retries ?? 2;
    const backoff = this.backoff;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let res: Response;
      try {
        res = await fetch(this.base + path, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          // Токен не должен уехать на чужой origin.
          redirect: 'manual',
          signal: AbortSignal.timeout(20000)
        });
      } catch (e) {
        if (attempt < retries) {
          await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
          continue;
        }
        throw new SaitamaError(0, 'UNREACHABLE', `SaitamaLinks не ответил: ${(e as Error).message}`);
      }
      if (res.status >= 300 && res.status < 400) {
        throw new SaitamaError(res.status, 'REDIRECT', 'SaitamaLinks ответил редиректом на другой адрес');
      }
      this.noteRateHeaders(res);

      const ct = res.headers.get('content-type') ?? '';
      const text = await res.text();
      const payload: unknown = ct.includes('json') ? safeJson(text) : text;
      if (res.ok) return { data: payload as T, res };

      const obj = (payload && typeof payload === 'object' ? payload : {}) as {
        error?: { code?: string; message?: string };
      };
      const code = obj.error?.code;
      const ra = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * this.retryAfterMs : backoff[Math.min(attempt, backoff.length - 1)];
      const retryable =
        (res.status === 429 && code !== 'daily_cap_exceeded') || res.status === 500 || res.status === 502 || res.status === 503;
      const tooLong = Number.isFinite(ra) && ra * 1000 > MAX_RETRY_WAIT_MS;
      if (retryable && attempt < retries && !tooLong) {
        await sleep(waitMs);
        continue;
      }
      throw new SaitamaError(res.status, code, obj.error?.message ?? `HTTP ${res.status} от SaitamaLinks`);
    }
  }

  /** Баланс, цена с индексацией и без — единственный источник цены. */
  async balance(): Promise<SaitamaBalance> {
    const { data: d } = await this.request<{
      balance: number;
      price_per_placement: number;
      price_per_placement_no_indexation?: number | null;
      tier?: { discount_pct?: number };
    }>('GET', '/balance');
    const priceMicros = usdToMicros(d.price_per_placement);
    const noIdx = d.price_per_placement_no_indexation;
    return {
      balanceMinor: usdToMinor(d.balance),
      priceMicros,
      priceNoIndexMicros: noIdx != null && Number(noIdx) > 0 ? usdToMicros(noIdx) : null,
      priceMinor: priceMicros / 10_000,
      currency: 'USD',
      discountPct: Number(d.tier?.discount_pct ?? 0)
    };
  }

  /**
   * Создаёт заказ и сразу списывает деньги. Повтор безопасен только благодаря
   * Idempotency-Key, поэтому без ключа метод не работает.
   */
  async createOrder(
    rows: SaitamaOrderRow[],
    opts: { idempotencyKey: string; indexation?: boolean; clientRef?: string }
  ): Promise<SaitamaCreated> {
    if (!opts.idempotencyKey) throw new Error('Idempotency-Key обязателен');
    const body = {
      items: rows,
      indexation: opts.indexation ?? true,
      ...(opts.clientRef ? { client_ref: opts.clientRef.slice(0, 128) } : {})
    };
    const { data: d, res } = await this.request<{
      order_id: string;
      status: string;
      total_count: number;
      total_price: number;
      price_per_placement: number;
      balance: number;
    }>('POST', '/orders', { body, headers: { 'Idempotency-Key': opts.idempotencyKey } });
    return {
      orderId: d.order_id,
      status: saitamaStatus(d.status),
      totalCount: Number(d.total_count),
      totalPriceMinor: usdToMinor(d.total_price),
      priceMinor: usdToMicros(d.price_per_placement) / 10_000,
      balanceAfterMinor: usdToMinor(d.balance),
      replayed: res.headers.get('idempotent-replay') === 'true'
    };
  }

  async order(orderId: string): Promise<SaitamaOrder> {
    const { data: d } = await this.request<Record<string, any>>('GET', `/orders/${encodeURIComponent(orderId)}`);
    const p = (d.progress ?? {}) as Record<string, number>;
    const num = (k: string) => Number(p[k] ?? 0);
    return {
      id: String(d.order_id),
      service: String(d.service ?? 'links'),
      status: saitamaStatus(d.status),
      createdAt: d.created_at ?? null,
      finalizedAt: d.finalized_at ?? null,
      priceMinor: usdToMicros(d.price_per_placement) / 10_000,
      totalPriceMinor: usdToMinor(d.total_price),
      refundedMinor: usdToMinor(d.refunded),
      clientRef: d.client_ref ?? null,
      indexation: d.indexation !== false,
      progress: {
        total: num('total'),
        published: num('published'),
        inProgress: num('in_progress'),
        awaitingContent: num('awaiting_content'),
        failed: num('failed'),
        remaining: num('remaining')
      },
      items: ((d.items ?? []) as Record<string, unknown>[]).map((it) => ({
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

  /** Опубликованные статьи; список растёт и после completed (бонусные). */
  async orderArticles(orderId: string): Promise<SaitamaArticle[]> {
    const { data: d } = await this.request<{ articles?: Record<string, any>[] }>(
      'GET',
      `/orders/${encodeURIComponent(orderId)}/articles`
    );
    return (d.articles ?? []).map((a) => ({
      id: String(a.id),
      url: String(a.url ?? ''),
      anchor: String(a.anchor ?? ''),
      title: a.title ?? '',
      publishedUrl: String(a.published_url ?? ''),
      publishedAt: a.published_at ?? null,
      indexation: String(a.indexation?.status ?? '')
    }));
  }

  /**
   * Заказы, созданные через API любым ключом аккаунта, новые сверху. Только
   * ссылки-статьи: картинки, морды и индексатор хаб не покупает.
   */
  async listOrders(maxPages = 10): Promise<SaitamaOrderListItem[]> {
    const out: SaitamaOrderListItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const q: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
      const { data: d } = await this.request<{ orders?: Record<string, any>[]; next_cursor?: string | null }>(
        'GET',
        `/orders${q}`
      );
      for (const o of d.orders ?? []) {
        if ((o.service ?? 'links') !== 'links') continue;
        out.push({
          id: String(o.order_id),
          service: String(o.service ?? 'links'),
          status: saitamaStatus(o.status),
          createdAt: o.created_at ?? null,
          finalizedAt: o.finalized_at ?? null,
          totalCount: Number(o.total_count ?? 0),
          totalPriceMinor: usdToMinor(o.total_price),
          clientRef: o.client_ref ?? null
        });
      }
      cursor = d.next_cursor ?? null;
      if (!cursor) break;
    }
    return out;
  }
}

// --- ключ --------------------------------------------------------------

export function getSaitamaToken(db: Db): string | undefined {
  return getConfigValue(db, 'SAITAMALINKS_API_TOKEN');
}

export function saitamaTokenSource(db: Db): 'env' | 'db' | 'none' {
  return configSource(db, 'SAITAMALINKS_API_TOKEN');
}

export function setSaitamaToken(db: Db, token: string): void {
  const clean = token.trim();
  if (!clean) throw new Error('token required');
  setConfigValue(db, 'SAITAMALINKS_API_TOKEN', clean);
}

export function clearSaitamaToken(db: Db): void {
  clearConfigValue(db, 'SAITAMALINKS_API_TOKEN');
}

export function getSaitamaBase(db: Db): string {
  return getConfigValue(db, 'SAITAMALINKS_API_BASE') ?? DEFAULT_BASE;
}

/** Похоже ли на ключ SaitamaLinks: sl_live_ или sl_test_ и 43 символа. */
export function looksLikeSaitamaToken(token: string): boolean {
  return /^sl_(live|test)_[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

/** null, пока ключ не введён. */
export function saitamaClient(db: Db): SaitamaClient | null {
  const token = getSaitamaToken(db);
  return token ? new SaitamaClient(token, getSaitamaBase(db)) : null;
}

/** UUID ли это: только такие id бывают у заказов SaitamaLinks. */
export function isSaitamaOrderId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { DEFAULT_BASE as SAITAMALINKS_DEFAULT_BASE };
