import { createHash } from 'node:crypto';
import type { Db } from './db';
import { LANGUAGE_CODES } from '$lib/utils/lang';
import { getConfigValue, configSource, setConfigValue, clearConfigValue } from './config';

// Единственный модуль, знающий MagicLinks Customer API (контракт 1.14.0).
// Роуты дёргают только его, как и в случае с google.ts. Данные сервиса нигде
// не кешируются: задачи, заказы и статусы всегда читаются живьём, в базе лежит
// только токен доступа — ровно как с GSC.

const DEFAULT_BASE = 'https://seoboost-root.info/api/customer/v1';

export interface MagicLinksLifecycle {
  trashedAt: string | null;
  executionState: 'active' | 'held' | string;
  clientStatus: 'prepared' | 'queued' | 'processing' | 'completed' | string;
  startedAt: string | null;
  cancellationLocked?: boolean;
  resumeBlockedReason?: string | null;
}

export interface MagicLinksBilling {
  mode: 'reserved' | 'charged' | 'test-unmetered' | string;
  currency: string;
  scale: number;
  amountMinor: number;
  reservedMinor?: number;
  settledMinor?: number;
  releasedMinor?: number;
  balanceAfterMinor?: number;
}

export interface MagicLinksOrderSummary {
  id: string;
  taskId?: string;
  type?: 'posts' | 'links' | string;
  status: 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | string;
  createdAt?: string;
  updatedAt?: string;
  rowCount: number;
  requestedCount?: number;
  bonusCount?: number;
  completedCount: number;
  failedCount: number;
  lifecycle?: MagicLinksLifecycle;
  billing?: MagicLinksBilling;
}

export interface MagicLinksTask {
  id: string;
  code?: string;
  name?: string;
  status: string;
  type: 'posts' | 'links' | string;
  topic?: string;
  source?: string;
  createdAt?: string;
  rowCount: number;
  placementCount: number;
  lifecycle?: MagicLinksLifecycle;
  order: MagicLinksOrderSummary | null;
}

export interface MagicLinksRow {
  id: string;
  taskRowId?: string;
  placementIndex?: number;
  isBonus?: boolean;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  outcome?: 'pending' | 'success' | 'failed' | string;
  input: {
    targetUrl: string;
    anchor: string;
    titleKeyword?: string;
    language: string;
    quantity?: number;
    tier?: string;
  };
  // Посты возвращают destination (URL публикации), ссылки — donor + text.
  result: { destination?: string; source?: string; donor?: string; text?: string } | null;
  error?: string | null;
  indexing?: { status: 'in_progress' | 'completed' | 'attention' | null } | null;
}

export interface MagicLinksBalance {
  balanceMinor: number;
  totalBalanceMinor: number;
  reservedMinor: number;
  scale: number;
  prices?: Record<string, number>;
}

export interface MagicLinksQuote {
  placementCount: number;
  bonusCount: number;
  totalPlacementCount: number;
  amountMinor: number;
  balanceMinor: number;
  shortfallMinor: number;
  canSubmit: boolean;
  billed: boolean;
  priceVersion?: string;
  billingMode?: string;
  indexingIncluded?: boolean;
  lines?: Array<{ service: string; quantity: number; unitMinor: number; amountMinor: number }>;
}

export interface MagicLinksBrief {
  targetUrl: string;
  anchor: string;
  titleKeyword: string;
  language: string;
  count?: number;
  quantity?: number;
}

/** Цена поста в minor units за одно заказанное размещение (0.2 кредита). */
export const POST_UNIT_MINOR = 20;

/** Бонус сервиса: 25% сверху, общий по заказу, с округлением вверх. */
export function bonusFor(requested: number): number {
  return Math.ceil(requested / 4);
}

export const MAX_COUNT_PER_BRIEF = 250;

/**
 * Проверка брифа до платных ручек: кривой бриф сервис отклонит и так, но
 * понятная ошибка в интерфейсе лучше, чем 400 из чужого API.
 */
export function validateBrief(b: MagicLinksBrief, index = 0): MagicLinksBrief {
  const where = `строка ${index + 1}`;
  const bad = (m: string): never => {
    throw new Error(`${where}: ${m}`);
  };

  const url = String(b.targetUrl ?? '').trim();
  if (!url) bad('нет URL акцептора');
  if (url.length > 2048) bad('URL акцептора длиннее 2048 символов');
  // Одна строка — один URL акцептора: ни списка, ни HTML, ни разметки.
  if (/\s/.test(url)) bad('в URL акцептора пробел, а нужен ровно один адрес');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return bad('URL акцептора не абсолютный');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') bad('URL акцептора не http(s)');
  if (parsed.username || parsed.password) bad('в URL акцептора есть логин или пароль');

  const anchor = String(b.anchor ?? '').trim();
  if (anchor.length < 1 || anchor.length > 300) bad('анкор должен быть 1-300 символов');
  if (/<[a-z/]/i.test(anchor)) bad('в анкоре HTML-теги');

  const titleKeyword = String(b.titleKeyword ?? '').trim();
  if (titleKeyword.length < 1 || titleKeyword.length > 300) bad('ключевые слова должны быть 1-300 символов');
  if (/<[a-z/]/i.test(titleKeyword)) bad('в ключевых словах HTML-теги');

  const language = String(b.language ?? '').trim();
  // Язык не выводится из гео и не угадывается по домену: сюда приходит только
  // то, что оператор выбрал сам.
  if (!LANGUAGE_CODES.has(language)) bad(`язык «${language || 'пусто'}» не из списка сервиса`);

  const raw = b.count ?? b.quantity;
  const count = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT_PER_BRIEF) {
    bad(`количество должно быть целым от 1 до ${MAX_COUNT_PER_BRIEF}`);
  }

  // count уходит JSON-числом, и только он: count вместе с quantity сервис отклоняет.
  return { targetUrl: url, anchor, titleKeyword, language, count };
}

/** Ключ идемпотентности из тела: повтор того же запроса не плодит задачи. */
export function idempotencyKeyFor(payload: unknown): string {
  return 'gschub-' + createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

export class MagicLinksError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = 'MagicLinksError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MagicLinksClient {
  private readonly token: string;
  private readonly base: string;
  private lastAt = 0;

  // Бюджет аккаунта — 60 запросов в минуту, поэтому запросы разносим сами:
  // одна страница хаба успевает сделать несколько вызовов подряд.
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
    opts: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      idempotencyKey?: string;
      expectedCredits?: number;
      retries?: number;
    } = {}
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json'
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.expectedCredits !== undefined) {
      headers['X-FieldLink-Expected-Credits'] = String(opts.expectedCredits);
    }

    const retries = opts.retries ?? 2;
    const backoff = [2000, 5000, 10000];
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // Авторизованный запрос не ходит за редиректом: заголовок с токеном не
        // должен уехать на чужой origin.
        redirect: 'manual',
        signal: AbortSignal.timeout(20000)
      });
      if (res.status >= 300 && res.status < 400) {
        throw new MagicLinksError(res.status, 'REDIRECT', 'MagicLinks ответил редиректом на другой адрес');
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
        code?: string;
        message?: string;
      };
      throw new MagicLinksError(
        res.status,
        obj.code,
        obj.message ?? `HTTP ${res.status} от MagicLinks`
      );
    }
  }

  health() {
    return this.request<{ ok: boolean; token?: { name?: string; scopes?: string[] } }>('GET', '/health');
  }

  balance() {
    return this.request<MagicLinksBalance>('GET', '/balance');
  }

  /** Все задачи аккаунта, вместе со сводкой их заказов. */
  async listTasks(limit = 100): Promise<MagicLinksTask[]> {
    const all: MagicLinksTask[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page: { tasks?: MagicLinksTask[]; nextOffset: number | null } = await this.request(
        'GET',
        '/tasks',
        { query: { offset, limit } }
      );
      all.push(...(page.tasks ?? []));
      offset = page.nextOffset;
      if (all.length >= 1000) break; // страховка от бесконечной прокрутки
    }
    return all;
  }

  async listOrders(limit = 100): Promise<MagicLinksOrderSummary[]> {
    const page = await this.request<{ orders?: MagicLinksOrderSummary[] }>('GET', '/orders', {
      query: { offset: 0, limit }
    });
    return page.orders ?? [];
  }

  /** Сохраняет задачу. Публикация при этом НЕ начинается и деньги не тратятся. */
  createPosts(payload: { name?: string; topic: string; items: MagicLinksBrief[] }, idempotencyKey: string) {
    return this.request<{ taskId?: string; task?: { id: string }; replayed?: boolean }>('POST', '/posts', {
      body: payload,
      idempotencyKey
    });
  }

  /** Исходные брифы задачи: по ним пишется история покупок. */
  async taskRows(taskId: string, pageSize = 100): Promise<MagicLinksBrief[]> {
    const out: MagicLinksBrief[] = [];
    let page = 0;
    for (;;) {
      const data = await this.request<{
        task?: { rows?: MagicLinksBrief[] };
        pagination?: { totalPages?: number };
      }>('GET', `/tasks/${encodeURIComponent(taskId)}/rows`, { query: { page, pageSize } });
      out.push(...(data.task?.rows ?? []));
      const totalPages = Number(data.pagination?.totalPages ?? 1);
      if (page + 1 >= totalPages) break;
      page++;
    }
    return out;
  }

  /**
   * Отправка заказа: пустое тело и фактическая сумма из только что полученного
   * расчёта в заголовке. Если цена успела измениться, сервис ответит 409
   * PRICE_CHANGED — заголовок для обхода конфликта не убираем.
   */
  submitOrder(taskId: string, expectedMinor: number) {
    return this.request<{ order: MagicLinksOrderSummary; replayed?: boolean }>(
      'POST',
      `/tasks/${encodeURIComponent(taskId)}/orders`,
      { query: { view: 'summary' }, expectedCredits: expectedMinor }
    );
  }

  quote(taskId: string) {
    return this.request<{ quote: MagicLinksQuote }>('GET', `/tasks/${encodeURIComponent(taskId)}/quote`)
      .then((d) => d.quote);
  }

  /**
   * Заказ целиком: читает все страницы и склеивает строки по id.
   * Страницы могут сдвигаться, пока меняются статусы, поэтому merge по id,
   * а не конкатенация.
   */
  async order(orderId: string, pageSize = 100): Promise<{ order: MagicLinksOrderSummary; rows: MagicLinksRow[] }> {
    const byId = new Map<string, MagicLinksRow>();
    let head: MagicLinksOrderSummary | null = null;
    let page = 0;
    for (;;) {
      const data = await this.request<{
        order: MagicLinksOrderSummary & { rows?: MagicLinksRow[]; pagination?: { totalPages?: number } };
      }>('GET', `/orders/${encodeURIComponent(orderId)}`, {
        query: { page, pageSize, status: 'all' }
      });
      const ord = data.order;
      head ??= ord;
      for (const row of ord.rows ?? []) byId.set(row.id, row);
      const totalPages = Number(ord.pagination?.totalPages ?? 1);
      if (page + 1 >= totalPages) break;
      page++;
    }
    if (!head) throw new MagicLinksError(404, 'NOT_FOUND', 'Заказ не найден');
    return { order: head, rows: [...byId.values()] };
  }
}

// --- токен -------------------------------------------------------------

/** Ключ виден в UI только хвостом: кто открыл страницу, тот его уже не унесёт. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function getMagicLinksToken(db: Db): string | undefined {
  return getConfigValue(db, 'MAGICLINKS_API_TOKEN');
}

export function magicLinksTokenSource(db: Db): 'env' | 'db' | 'none' {
  return configSource(db, 'MAGICLINKS_API_TOKEN');
}

export function setMagicLinksToken(db: Db, token: string): void {
  const clean = token.trim();
  if (!clean) throw new Error('token required');
  setConfigValue(db, 'MAGICLINKS_API_TOKEN', clean);
}

export function clearMagicLinksToken(db: Db): void {
  clearConfigValue(db, 'MAGICLINKS_API_TOKEN');
}

export function getMagicLinksBase(db: Db): string {
  return getConfigValue(db, 'MAGICLINKS_API_BASE') ?? DEFAULT_BASE;
}

/** null, пока ключ не введён: страница тогда показывает форму, а не ошибку. */
export function magicLinksClient(db: Db): MagicLinksClient | null {
  const token = getMagicLinksToken(db);
  return token ? new MagicLinksClient(token, getMagicLinksBase(db)) : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { DEFAULT_BASE as MAGICLINKS_DEFAULT_BASE };
