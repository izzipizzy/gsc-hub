import { cachedMagicLinksClient, cachedMagic369Client, cachedProviderRead, providerCacheState, invalidateProviderCache } from '$lib/server/magiclinks-cache';
import { readBacklinkDashboard } from '$lib/server/backlink-snapshots';
import { backlinkSettings, validateProxy } from '$lib/server/backlink-fetch';
import { setConfigValue, clearConfigValue } from '$lib/server/config';
import { readChecks, checkSummary, latestJob, providerCheckTotals } from '$lib/server/backlink-monitor';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { importOrderHistory, listPurchases } from '$lib/server/magiclinks-purchases';
import {
  magicLinksTokenSource,
  getMagicLinksToken,
  getMagicLinksBase,
  setMagicLinksToken,
  clearMagicLinksToken,
  maskToken,
  MagicLinksError,
  type MagicLinksTask,
  type MagicLinksBalance,
  type MagicLinksRow
} from '$lib/server/magiclinks';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369, type MagicProviderId } from '$lib/server/magiclinks-providers';
import {
  magic369TokenSource,
  getMagic369Token,
  getMagic369Base,
  setMagic369Token,
  clearMagic369Token,
  Magic369Error,
  type Magic369Balance
} from '$lib/server/magic369';

function hostOfUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Страница сервиса: настройки ключей обоих провайдеров + все задания с их
// статусами. Читающие ответы сохраняются в SQLite; повторный заход в пределах
// TTL не обращается к провайдерам. Задания показывает только FieldLink: у 369Team списка заказов в API
// нет, его покупки видны в истории и по прямой ссылке.
export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const database = db();
  const token = getMagicLinksToken(database);
  const base = getMagicLinksBase(database);
  const source = magicLinksTokenSource(database);
  const token369 = getMagic369Token(database);
  const base369 = getMagic369Base(database);
  const source369 = magic369TokenSource(database);

  const m369 = {
    configured: !!token369,
    source: source369,
    base: base369,
    masked: token369 ? maskToken(token369) : null,
    balance: null as Magic369Balance | null,
    error: null as string | null
  };
  if (token369) {
    try {
      m369.balance = await cachedMagic369Client(database)!.balance();
    } catch (e) {
      m369.error =
        e instanceof Magic369Error
          ? `${e.message}${e.status === 401 ? ' (проверь ключ)' : ''}`
          : '369Team не ответил';
    }
  }

  // Строки таблицы заказов: задания FieldLink и заказы 369Team одним списком,
  // у каждой строки свой провайдер.
  const orders: OrderRow[] = [];
  let balance: MagicLinksBalance | null = null;
  let error: string | null = null;

  if (token) {
    const client = cachedMagicLinksClient(database)!;
    let tasks: MagicLinksTask[] = [];
    try {
      // Параллельно: оба вызова читающие, бюджет аккаунта это выдерживает.
      [balance, tasks] = await Promise.all([client.balance(), client.listTasks()]);

      // История покупок догоняется сама, при заходе на страницу: заказ мог уйти
      // из CLI или из кабинета сервиса, и тогда таблицы striking о нём не знают.
      // Запросы идут только по заказам, которых ещё нет в истории, поэтому на
      // второй заход это бесплатно.
      await cachedProviderRead(database, 'fieldlink:history-import', () => importOrderHistory(database, client, hostOfUrl), 15*60_000);
    } catch (e) {
      // Сервис недоступен или ключ отозван - страница всё равно открывается,
      // иначе ключ будет нечем заменить.
      error =
        e instanceof MagicLinksError
          ? `${e.message}${e.status === 401 ? ' (проверь ключ)' : ''}`
          : 'MagicLinks не ответил';
    }

    // Индексацию сервис отдаёт только построчно, в позициях заказа, поэтому
    // сводку по заказу собираем из его строк. Не ответил - колонка пустая,
    // страница от этого не падает.
    const indexing = await Promise.all(
      tasks.map((t) =>
        t.order ? client.order(t.order.id).then((o) => indexingSummary(o.rows)).catch(() => null) : null
      )
    );

    tasks.forEach((t, i) =>
      orders.push({
        provider: PROVIDER_FIELDLINK,
        id: t.id,
        code: t.code ?? null,
        name: t.name ?? null,
        type: t.type,
        createdAt: t.createdAt ?? null,
        rowCount: t.rowCount,
        placementCount: t.placementCount,
        order: t.order
          ? {
              id: t.order.id,
              status: t.order.status,
              rowCount: t.order.rowCount,
              completedCount: t.order.completedCount,
              failedCount: t.order.failedCount,
              held: t.order.lifecycle?.executionState === 'held',
              trashed: !!t.order.lifecycle?.trashedAt
            }
          : null,
        indexing: indexing[i]
      })
    );
  }

  // Заказы 369Team: списка в их API нет, так что берём id из истории покупок
  // хаба, а статус читаем живьём по каждому.
  const purchases = listPurchases(database);
  const client369 = cachedMagic369Client(database);
  const by369 = new Map<string, { createdAt: number; hosts: Set<string>; briefs: number }>();
  for (const p of purchases) {
    if (p.provider !== PROVIDER_MAGIC369) continue;
    const e = by369.get(p.orderId) ?? { createdAt: p.createdAt, hosts: new Set<string>(), briefs: 0 };
    e.createdAt = Math.min(e.createdAt, p.createdAt);
    e.hosts.add(p.siteHost);
    e.briefs++;
    by369.set(p.orderId, e);
  }
  const ids369 = [...by369.keys()];
  const live369 = await Promise.all(
    ids369.map((id) => (client369 ? client369.order(id).catch(() => null) : Promise.resolve(null)))
  );
  ids369.forEach((id, i) => {
    const h = by369.get(id)!;
    const o = live369[i];
    orders.push({
      provider: PROVIDER_MAGIC369,
      id,
      code: id.slice(0, 8),
      name: [...h.hosts].join(', '),
      type: 'posts',
      createdAt: o?.createdAt ?? new Date(h.createdAt).toISOString(),
      rowCount: h.briefs,
      placementCount: o?.progress.total ?? 0,
      order: o
        ? {
            id,
            status: o.status,
            rowCount: o.progress.total,
            completedCount: o.progress.published,
            failedCount: o.progress.failed,
            held: false,
            trashed: false
          }
        : { id, status: client369 ? 'нет ответа' : 'нет ключа', rowCount: 0, completedCount: 0, failedCount: 0, held: false, trashed: false },
      // Индексации в API 369Team нет.
      indexing: null
    });
  });

  orders.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  // Сколько заказов уже попало в историю покупок: по ним таблицы striking
  // показывают «куплено» ещё до открытия заказа.
  const purchasedOrders = new Set(purchases.map((p) => p.orderId)).size;

  const checks = readChecks(database);
  return {
    configured: !!token,
    source,
    base,
    masked: token ? maskToken(token) : null,
    balance,
    error,
    purchasedOrders,
    m369,
    orders: orders.map((o) => ({ ...o, backlinks: checkSummary(checks.filter((c) => c.provider === o.provider && c.orderId === o.order?.id)) })),
    backlinkSettings: backlinkSettings(database),
    checkJob: latestJob(database),
    checkSummary: checkSummary(checks),
    checkDashboard: readBacklinkDashboard(database, providerCheckTotals(checks)),
    providerCache: providerCacheState(database)
  };
};

interface IndexingSummary {
  inProgress: number;
  completed: number;
  attention: number;
  /** Отправки на индексацию ещё не было. */
  none: number;
}

interface OrderRow {
  provider: MagicProviderId;
  id: string;
  code: string | null;
  name: string | null;
  type: string;
  createdAt: string | null;
  rowCount: number;
  placementCount: number;
  order: {
    id: string;
    status: string;
    rowCount: number;
    completedCount: number;
    failedCount: number;
    held: boolean;
    trashed: boolean;
  } | null;
  indexing: IndexingSummary | null;
}

function indexingSummary(rows: MagicLinksRow[]): IndexingSummary {
  const s: IndexingSummary = { inProgress: 0, completed: 0, attention: 0, none: 0 };
  for (const r of rows) {
    const st = r.indexing?.status;
    if (st === 'in_progress') s.inProgress++;
    else if (st === 'completed') s.completed++;
    else if (st === 'attention') s.attention++;
    else s.none++;
  }
  return s;
}

export const actions: Actions = {
  refreshProviders: async ({ locals }) => {
    requireAdmin(locals);
    invalidateProviderCache(db());
    return { providersRefreshed: true };
  },
  saveBacklinkSettings: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const proxy = String(form.get('proxy') ?? '').trim();
    if (proxy.length > 1000) return fail(400, { error: 'Прокси URL слишком длинный' });
    try { if (proxy) validateProxy(proxy); } catch (e) { return fail(400, { error: (e as Error).message }); }
    const database = db();
    database.transaction(() => {
      if (proxy) setConfigValue(database, 'BACKLINK_PROXY_URL', proxy);
      if (form.has('clearProxy')) clearConfigValue(database, 'BACKLINK_PROXY_URL');
      setConfigValue(database, 'BACKLINK_AUTO_ENABLED', form.has('automatic') ? '1' : '0');
    })();
    return { backlinkSaved: true };
  },
  saveToken: async ({ request, locals }) => {
    requireAdmin(locals);
    const token = String((await request.formData()).get('token') ?? '').trim();
    if (!token) return fail(400, { error: 'Пустой ключ' });
    if (token.length < 16 || /\s/.test(token)) return fail(400, { error: 'Это не похоже на ключ MagicLinks' });
    setMagicLinksToken(db(), token);
    invalidateProviderCache(db());
    return { saved: true };
  },
  save369Token: async ({ request, locals }) => {
    requireAdmin(locals);
    const token = String((await request.formData()).get('token') ?? '').trim();
    if (!token) return fail(400, { error: 'Пустой ключ 369Team' });
    if (token.length < 16 || /\s/.test(token)) return fail(400, { error: 'Это не похоже на ключ 369Team' });
    setMagic369Token(db(), token);
    invalidateProviderCache(db());
    return { saved369: true };
  },
  /** Заказы из CLI, кабинета сервиса или сделанные до появления истории. */
  importHistory: async ({ locals }) => {
    requireAdmin(locals);
    const client = cachedMagicLinksClient(db());
    if (!client) return fail(400, { error: 'Ключ MagicLinks не задан' });
    try {
      const res = await cachedProviderRead(db(), 'fieldlink:history-import', () => importOrderHistory(db(), client, hostOfUrl), 15*60_000, true);
      return { imported: res };
    } catch (e) {
      return fail(502, { error: e instanceof MagicLinksError ? e.message : 'Сервис не ответил' });
    }
  },
  clearToken: async ({ locals }) => {
    requireAdmin(locals);
    clearMagicLinksToken(db());
    invalidateProviderCache(db());
    return { cleared: true };
  },
  clear369Token: async ({ locals }) => {
    requireAdmin(locals);
    clearMagic369Token(db());
    invalidateProviderCache(db());
    return { cleared369: true };
  }
};
